import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeEmail, isValidEmailForSend } from './email-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function initDatabase(dbPath) {
  const db = new Database(dbPath || path.join(__dirname, 'data', 'canada.db'));
  
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS companies (
      business_id   TEXT PRIMARY KEY,
      company_name  TEXT NOT NULL,
      website       TEXT,
      fetched_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS email_records (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      company_name  TEXT NOT NULL,
      business_id   TEXT NOT NULL,
      website       TEXT,
      email         TEXT NOT NULL,
      email_type    TEXT NOT NULL DEFAULT 'general',
      source        TEXT NOT NULL DEFAULT 'website',
      found_date    TEXT NOT NULL DEFAULT (datetime('now')),
      excluded      INTEGER NOT NULL DEFAULT 0,
      verified      INTEGER NOT NULL DEFAULT 0,
      verification_score REAL,
      ai_intro      TEXT,
      variant       TEXT DEFAULT 'A',
      UNIQUE(business_id, email COLLATE NOCASE)
    );

    CREATE TABLE IF NOT EXISTS replies (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT NOT NULL,
      company_name  TEXT NOT NULL,
      subject       TEXT,
      body          TEXT,
      sentiment     TEXT, -- interested, curious, rejected, ooo (out of office)
      received_at   TEXT NOT NULL DEFAULT (datetime('now')),
      processed     INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS send_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT NOT NULL UNIQUE,
      company_name  TEXT NOT NULL,
      sent_at       TEXT NOT NULL DEFAULT (datetime('now')),
      opened        INTEGER NOT NULL DEFAULT 0,
      opened_at     TEXT,
      is_hot_lead   INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS send_log_saas (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT NOT NULL UNIQUE,
      company_name  TEXT NOT NULL,
      status        TEXT DEFAULT 'SENT',
      sent_at       TEXT NOT NULL DEFAULT (datetime('now')),
      followup_sent INTEGER DEFAULT 0,
      is_hot_lead   INTEGER DEFAULT 0,
      linkedin_url  TEXT,
      opens         INTEGER DEFAULT 0,
      last_opened_at TEXT,
      sales_intent  TEXT,
      ai_sentiment  TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_email_records_type ON email_records(email_type);
    CREATE INDEX IF NOT EXISTS idx_email_records_source ON email_records(source);
    CREATE INDEX IF NOT EXISTS idx_email_records_excluded ON email_records(excluded);
    CREATE INDEX IF NOT EXISTS idx_email_records_verified ON email_records(verified);
    CREATE INDEX IF NOT EXISTS idx_email_records_business ON email_records(business_id);
    CREATE INDEX IF NOT EXISTS idx_send_log_email ON send_log(email);
    CREATE INDEX IF NOT EXISTS idx_send_log_saas_email ON send_log_saas(email);
    CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(company_name);
    CREATE INDEX IF NOT EXISTS idx_email_records_name ON email_records(company_name);

    CREATE TABLE IF NOT EXISTS notifications (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      type          TEXT NOT NULL,
      severity      TEXT NOT NULL DEFAULT 'info',
      title         TEXT NOT NULL,
      message       TEXT,
      metadata      TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      read          INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
    CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);

    CREATE TABLE IF NOT EXISTS notification_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      notification_id INTEGER,
      channel       TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'sent',
      error_message TEXT,
      sent_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS provider_usage (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      provider      TEXT NOT NULL,
      action        TEXT NOT NULL,
      status        TEXT NOT NULL,
      duration_ms   INTEGER,
      cost          REAL DEFAULT 0,
      target        TEXT,
      error_message TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_provider_usage_provider ON provider_usage(provider);
    CREATE INDEX IF NOT EXISTS idx_provider_usage_action ON provider_usage(action);
    CREATE INDEX IF NOT EXISTS idx_provider_usage_created ON provider_usage(created_at);

    CREATE TABLE IF NOT EXISTS dead_letter_queue (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      queue_name    TEXT NOT NULL,
      item_data     TEXT NOT NULL,
      error_message TEXT,
      retry_count   INTEGER DEFAULT 0,
      max_retries   INTEGER DEFAULT 3,
      failed_at     TEXT NOT NULL DEFAULT (datetime('now')),
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      status        TEXT DEFAULT 'pending'
    );

    CREATE INDEX IF NOT EXISTS idx_dlq_queue ON dead_letter_queue(queue_name);
    CREATE INDEX IF NOT EXISTS idx_dlq_retry ON dead_letter_queue(retry_count);
    CREATE INDEX IF NOT EXISTS idx_dlq_created ON dead_letter_queue(created_at);

    CREATE TABLE IF NOT EXISTS warmup_state (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      account_email TEXT NOT NULL UNIQUE,
      warmup_group  TEXT NOT NULL DEFAULT 'main',
      day          INTEGER DEFAULT 0,
      sent_today   INTEGER DEFAULT 0,
      total_sent   INTEGER DEFAULT 0,
      max_daily    INTEGER DEFAULT 5,
      is_active    INTEGER DEFAULT 1,
      started_at   TEXT NOT NULL DEFAULT (datetime('now')),
      last_reset   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bounce_tracker (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT NOT NULL,
      target_domain TEXT NOT NULL,
      bounce_type   TEXT NOT NULL DEFAULT 'hard',
      campaign      TEXT NOT NULL DEFAULT 'main',
      count         INTEGER DEFAULT 1,
      first_seen    TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen     TEXT NOT NULL DEFAULT (datetime('now')),
      suppressed    INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_bounce_email ON bounce_tracker(email);
    CREATE INDEX IF NOT EXISTS idx_bounce_suppressed ON bounce_tracker(suppressed);
    CREATE INDEX IF NOT EXISTS idx_warmup_account ON warmup_state(account_email);
    CREATE INDEX IF NOT EXISTS idx_warmup_active ON warmup_state(is_active);
  `);

  // --- SAFE MIGRATIONS ---
  // Safe index creation (tables may exist without these columns)
  try { db.prepare('CREATE INDEX IF NOT EXISTS idx_provider_usage_status ON provider_usage(status)').run(); } catch {}
  try { db.prepare('CREATE INDEX IF NOT EXISTS idx_dlq_status ON dead_letter_queue(status)').run(); } catch {}

  const columns = [
    ['status', "TEXT DEFAULT 'SENT'"],
    ['followup_sent', 'INTEGER DEFAULT 0'],
    ['is_hot_lead', 'INTEGER DEFAULT 0'],
    ['linkedin_url', 'TEXT'],
    ['opens', 'INTEGER DEFAULT 0'],
    ['last_opened_at', 'TEXT'],
    ['sales_intent', 'TEXT'],
    ['ai_sentiment', 'TEXT']
  ];

  for (const [col, type] of columns) {
    try {
      db.prepare(`ALTER TABLE send_log_saas ADD COLUMN ${col} ${type}`).run();
    } catch (e) {}
  }

  // --- email_records Migrations ---
  try {
    db.prepare(`ALTER TABLE email_records ADD COLUMN linkedin_url TEXT`).run();
  } catch (e) {}
  try {
    db.prepare(`ALTER TABLE email_records ADD COLUMN ai_intro TEXT`).run();
  } catch (e) {}
  const emailRecordFitCols = [
    ['fit_score', 'INTEGER'],
    ['fit_verdict', 'TEXT'],
    ['fit_evaluated_at', 'TEXT'],
  ];
  for (const [col, type] of emailRecordFitCols) {
    try { db.prepare(`ALTER TABLE email_records ADD COLUMN ${col} ${type}`).run(); } catch {}
  }

  // --- send_log Migrations ---
  const sendLogCols = [
    ['opened', 'INTEGER NOT NULL DEFAULT 0'],
    ['opened_at', 'TEXT'],
    ['is_hot_lead', 'INTEGER NOT NULL DEFAULT 0'],
    ['fit_score', 'INTEGER'],
    ['fit_verdict', 'TEXT'],
    ['application_status', "TEXT DEFAULT 'applied'"],
  ];
  for (const [col, type] of sendLogCols) {
    try { db.prepare(`ALTER TABLE send_log ADD COLUMN ${col} ${type}`).run(); } catch {}
  }

  sanitizeMalformedEmails(db);
  
  return db;
}

function sanitizeMalformedEmails(db) {
  const suspicious = db.prepare(`
    SELECT id, email FROM email_records
    WHERE email LIKE '%20%' OR email LIKE '% %' OR email LIKE '%@%@%'
  `).all();

  for (const row of suspicious) {
    const fixed = normalizeEmail(row.email);
    if (fixed && isValidEmailForSend(fixed) && fixed !== row.email) {
      try {
        db.prepare('UPDATE email_records SET email = ? WHERE id = ?').run(fixed, row.id);
      } catch {
        db.prepare('UPDATE email_records SET excluded = 1 WHERE id = ?').run(row.id);
      }
    } else if (!isValidEmailForSend(row.email)) {
      db.prepare('UPDATE email_records SET excluded = 1 WHERE id = ?').run(row.id);
    }
  }
}

export function getStats(db) {
  const companies = db.prepare('SELECT COUNT(*) as count FROM companies').get();
  const emails = db.prepare('SELECT COUNT(*) as count FROM email_records').get();
  const verified = db.prepare('SELECT COUNT(*) as count FROM email_records WHERE verified = 1').get();
  const sent = db.prepare('SELECT COUNT(*) as count FROM send_log').get();
  const errors = 0; // tracked in memory during scan
  
  const emailsByType = db.prepare(`
    SELECT email_type, COUNT(*) as count 
    FROM email_records 
    GROUP BY email_type
  `).all();
  
  const emailsByDay = db.prepare(`
    SELECT DATE(found_date) as day, COUNT(*) as count 
    FROM email_records 
    WHERE found_date >= datetime('now', '-30 days')
    GROUP BY DATE(found_date)
    ORDER BY day
  `).all();

  const saasEmailsByDay = db.prepare(`
    SELECT DATE(sent_at) as day, COUNT(*) as count 
    FROM send_log_saas 
    WHERE sent_at >= datetime('now', '-30 days')
    GROUP BY DATE(sent_at)
    ORDER BY day
  `).all();

  const applications = db.prepare('SELECT COUNT(*) as count FROM send_log').get();
  const fitEvaluated = db.prepare('SELECT COUNT(*) as count FROM email_records WHERE fit_score IS NOT NULL').get();
  const skippedLowFit = db.prepare(`
    SELECT COUNT(*) as count FROM email_records
    WHERE fit_score IS NOT NULL AND fit_score < 45 AND excluded = 1
  `).get();
  
  return {
    totalCompanies: companies.count,
    emailsDiscovered: emails.count,
    emailsVerified: verified.count,
    emailsSent: sent.count,
    applications: applications.count,
    fitEvaluated: fitEvaluated.count,
    skippedLowFit: skippedLowFit.count,
    errors,
    emailsByType,
    emailsByDay,
    saasEmailsByDay
  };
}

export function getEmails(db, { page = 1, limit = 50, type, search, excluded }) {
  let where = [];
  let params = {};
  
  if (type) {
    where.push('email_type = @type');
    params.type = type;
  }
  if (search) {
    where.push('(company_name LIKE @search OR email LIKE @search)');
    params.search = `%${search}%`;
  }
  if (excluded !== undefined) {
    where.push('excluded = @excluded');
    params.excluded = excluded ? 1 : 0;
  }
  
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const offset = (page - 1) * limit;
  
  const total = db.prepare(`SELECT COUNT(*) as count FROM email_records ${whereClause}`).get(params);
  
  const records = db.prepare(`
    SELECT er.*, 
           CASE WHEN sl.email IS NOT NULL THEN 1 ELSE 0 END as sent
    FROM email_records er
    LEFT JOIN send_log sl ON er.email = sl.email
    ${whereClause}
    ORDER BY er.found_date DESC
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit, offset });
  
  return {
    records,
    total: total.count,
    page,
    limit,
    totalPages: Math.ceil(total.count / limit)
  };
}

export function insertCompany(db, company) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO companies (business_id, company_name, website, fetched_at)
    VALUES (@business_id, @company_name, @website, datetime('now'))
  `);
  return stmt.run(company);
}

export function insertEmailRecord(db, record) {
  const email = normalizeEmail(record.email) || record.email?.toLowerCase()?.trim();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO email_records (company_name, business_id, website, email, email_type, source, found_date, verified, verification_score, linkedin_url)
    VALUES (@company_name, @business_id, @website, @email, @email_type, @source, datetime('now'), @verified, @verification_score, @linkedin_url)
  `);
  return stmt.run({
    verified: 0,
    verification_score: null,
    linkedin_url: null,
    ...record,
    email,
  });
}

export function toggleExcluded(db, id) {
  return db.prepare('UPDATE email_records SET excluded = NOT excluded WHERE id = ?').run(id);
}

export function markAsReplied(db, email) {
  return db.prepare('UPDATE email_records SET excluded = 1 WHERE LOWER(email) = ?').run(email.toLowerCase());
}

export function insertSendLog(db, email, companyName, extras = {}) {
  const { fitScore, fitVerdict, applicationStatus = 'applied' } = extras;
  return db.prepare(`
    INSERT OR IGNORE INTO send_log (email, company_name, sent_at, fit_score, fit_verdict, application_status)
    VALUES (?, ?, datetime('now'), ?, ?, ?)
  `).run(email.toLowerCase(), companyName, fitScore ?? null, fitVerdict ?? null, applicationStatus);
}

export function saveEmailFitEvaluation(db, email, fitScore, fitVerdict) {
  return db.prepare(`
    UPDATE email_records
    SET fit_score = ?, fit_verdict = ?, fit_evaluated_at = datetime('now')
    WHERE LOWER(email) = LOWER(?)
  `).run(fitScore, fitVerdict, email);
}

export function updateApplicationStatus(db, email, status) {
  return db.prepare(`
    UPDATE send_log SET application_status = ? WHERE LOWER(email) = LOWER(?)
  `).run(status, email);
}

export function getApplications(db, { page = 1, limit = 50, status } = {}) {
  let where = [];
  const params = { limit, offset: (page - 1) * limit };

  if (status) {
    where.push('sl.application_status = @status');
    params.status = status;
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) as count FROM send_log sl ${whereClause}`).get(params);

  const records = db.prepare(`
    SELECT sl.*,
           er.website,
           er.email_type,
           er.fit_score as pre_send_fit_score,
           r.sentiment as reply_sentiment,
           r.received_at as reply_at
    FROM send_log sl
    LEFT JOIN email_records er ON LOWER(sl.email) = LOWER(er.email)
    LEFT JOIN replies r ON LOWER(sl.email) = LOWER(r.email)
    ${whereClause}
    ORDER BY sl.sent_at DESC
    LIMIT @limit OFFSET @offset
  `).all(params);

  return {
    records,
    total: total.count,
    page,
    limit,
    totalPages: Math.ceil(total.count / limit),
  };
}

export function getFitStats(db) {
  const evaluated = db.prepare(`
    SELECT COUNT(*) as count FROM email_records WHERE fit_score IS NOT NULL
  `).get();
  const skipped = db.prepare(`
    SELECT COUNT(*) as count FROM email_records
    WHERE fit_score IS NOT NULL AND fit_score < 45 AND excluded = 1
  `).get();
  const byVerdict = db.prepare(`
    SELECT fit_verdict, COUNT(*) as count
    FROM email_records
    WHERE fit_verdict IS NOT NULL
    GROUP BY fit_verdict
  `).all();
  return {
    evaluated: evaluated.count,
    skippedLowFit: skipped.count,
    byVerdict,
  };
}

export function insertSaaSLog(db, email, companyName, linkedinUrl = null) {
  return db.prepare(`
    INSERT OR IGNORE INTO send_log_saas (email, company_name, linkedin_url, sent_at)
    VALUES (?, ?, ?, datetime('now'))
  `).run(email.toLowerCase(), companyName, linkedinUrl);
}

export function getUnsent(db) {
  return db.prepare(`
    WITH RankedEmails AS (
      SELECT er.*,
             ROW_NUMBER() OVER(
               PARTITION BY LOWER(er.company_name) 
               ORDER BY 
                 CASE er.email_type
                   WHEN 'hr' THEN 1
                   WHEN 'management' THEN 2
                   WHEN 'personal' THEN 3
                   WHEN 'info' THEN 4
                   ELSE 5
                 END ASC,
                 er.found_date ASC
             ) as rn
      FROM email_records er
      WHERE er.excluded = 0
        AND er.verified = 1
        -- Include SAAS-FIN companies IF they have hr/management/personal emails
        AND (
          er.business_id NOT LIKE 'SAAS-%'
          OR er.email_type IN ('hr', 'management', 'personal')
        )
        AND NOT EXISTS (SELECT 1 FROM send_log sl WHERE LOWER(sl.email) = LOWER(er.email))
        AND NOT EXISTS (SELECT 1 FROM send_log_saas sls WHERE LOWER(sls.email) = LOWER(er.email))
    )
    SELECT * FROM RankedEmails 
    WHERE rn <= 3
    ORDER BY 
      CASE email_type
        WHEN 'hr' THEN 1
        WHEN 'management' THEN 2
        WHEN 'personal' THEN 3
        ELSE 4
      END ASC,
      found_date DESC
  `).all() || [];
}

export function getUnsentSaaS(db) {
  return db.prepare(`
    WITH RankedEmails AS (
      SELECT er.*,
             ROW_NUMBER() OVER(
               PARTITION BY LOWER(er.company_name) 
               ORDER BY 
                 CASE er.email_type
                   WHEN 'management' THEN 1
                   WHEN 'hr' THEN 2
                   WHEN 'info' THEN 3
                   ELSE 4
                 END ASC,
                 er.found_date ASC
             ) as rn
      FROM email_records er
      WHERE er.excluded = 0
        AND er.verified = 1
        AND er.business_id LIKE 'SAAS-%'
        AND NOT EXISTS (SELECT 1 FROM send_log_saas sls WHERE LOWER(sls.email) = LOWER(er.email))
        AND NOT EXISTS (SELECT 1 FROM send_log sl WHERE LOWER(sl.email) = LOWER(er.email))
    )
    SELECT * FROM RankedEmails WHERE rn <= 2
    ORDER BY found_date ASC
  `).all() || [];
}

export function getSaaSFollowupCandidates(db, daysDelay = 3) {
  return db.prepare(`
    SELECT sls.*, er.ai_intro, er.email_type, er.website
    FROM send_log_saas sls
    JOIN email_records er ON LOWER(sls.email) = LOWER(er.email)
    WHERE sls.followup_sent = 0
      AND sls.sent_at <= datetime('now', '-' || ? || ' days')
      AND LOWER(sls.email) NOT IN (SELECT LOWER(email) FROM replies)
    LIMIT 50
  `).all(daysDelay) || [];
}

export function markSaaSFollowupSent(db, email) {
  return db.prepare(`
    UPDATE send_log_saas 
    SET followup_sent = 1, sent_at = datetime('now') 
    WHERE LOWER(email) = LOWER(?)
  `).run(email.toLowerCase());
}

export function recordEmailOpen(db, email, isSaaS = false, threshold = 3) {
  const normEmail = email.toLowerCase();
  if (isSaaS) {
    db.prepare(`
      UPDATE send_log_saas 
      SET opened = opened + 1, last_opened_at = datetime('now'),
          is_hot_lead = CASE WHEN opened + 1 >= ? THEN 1 ELSE is_hot_lead END
      WHERE LOWER(email) = ?
    `).run(threshold, normEmail);
  } else {
    db.prepare(`
      UPDATE send_log 
      SET opened = opened + 1, opened_at = CASE WHEN opened_at IS NULL THEN datetime('now') ELSE opened_at END,
          is_hot_lead = CASE WHEN opened + 1 >= ? THEN 1 ELSE is_hot_lead END
      WHERE LOWER(email) = ?
    `).run(threshold, normEmail);
  }
}
