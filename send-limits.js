/**
 * Sending Limits & Domain Throttling
 * Prevents blacklisting by enforcing per-account daily caps and domain throttling.
 */
let _db = null;
let _config = {};

export function initSendLimits(db, config) {
  _db = db;
  _config = config;
}

function cfg(path, def) {
  const parts = path.split('.');
  let obj = _config;
  for (const p of parts) {
    if (obj == null) return def;
    obj = obj[p];
  }
  return obj != null ? obj : def;
}

export function getDailyUsage(accountEmail) {
  if (!_db) return 0;
  const today = new Date().toISOString().slice(0, 10);
  const row = _db.prepare(`
    SELECT COUNT(*) as count FROM send_log WHERE email IN (
      SELECT email FROM email_records WHERE source = ? OR source LIKE '%warmup%'
    ) AND sent_at >= ?
  `).get(`smtp:${accountEmail}`, today);
  return row?.count || 0;
}

export function getDomainUsage(domain, campaign = 'main') {
  if (!_db) return 0;
  const today = new Date().toISOString().slice(0, 10);
  const table = campaign === 'saas' ? 'send_log_saas' : 'send_log';
  const row = _db.prepare(`
    SELECT COUNT(*) as count FROM ${table} WHERE email LIKE ? AND sent_at >= ?
  `).get(`%@${domain}`, today);
  return row?.count || 0;
}

export function getDomainUsageLastMinute(domain) {
  if (!_db) return 0;
  const row = _db.prepare(`
    SELECT COUNT(*) as count FROM send_log WHERE email LIKE ? AND sent_at >= datetime('now', '-1 minute')
  `).get(`%@${domain}`);
  return row?.count || 0;
}

export function canSendToDomain(domain, campaign = 'main') {
  const limits = cfg('sending_limits', {});
  const maxPerDay = campaign === 'saas' ? cfg('saas_sending.max_per_domain_per_day', 30) : limits.max_emails_per_domain_per_day || 20;
  const maxPerMin = limits.max_emails_per_domain_per_minute || 2;

  const dayUsage = getDomainUsage(domain, campaign);
  if (dayUsage >= maxPerDay) return { allowed: false, reason: `domain daily cap ${maxPerDay}`, resetAfter: 'tomorrow' };

  const minUsage = getDomainUsageLastMinute(domain);
  if (minUsage >= maxPerMin) return { allowed: false, reason: `domain rate ${maxPerMin}/min`, resetAfter: '1 minute' };

  return { allowed: true };
}

export function checkDailyAccountCap(accountEmail, campaign = 'main') {
  if (!_db) return true;
  const today = new Date().toISOString().slice(0, 10);
  const maxDaily = campaign === 'saas' ? cfg('saas_sending.max_per_account_per_day', 100) : cfg('sending_limits.max_emails_per_account_per_day', 80);

  const logs = _db.prepare(`
    SELECT COUNT(*) as count FROM send_log WHERE sent_at >= ? AND email IN (
      SELECT email FROM email_records WHERE source = ? OR source = ?
    )
  `).get(today, `smtp:${accountEmail}`, 'resend');

  const warmupSent = _db.prepare(`
    SELECT COALESCE(SUM(sent_today), 0) as total FROM warmup_state WHERE account_email = ?
  `).get(accountEmail);

  const total = (logs?.count || 0) + (warmupSent?.total || 0);
  if (total >= maxDaily) {
    return { allowed: false, reason: `account daily cap ${maxDaily}`, sent: total };
  }
  return { allowed: true, sent: total, remaining: maxDaily - total };
}

export async function enforceDelay(recordEmail, campaign = 'main') {
  if (!_db) return;
  const domain = recordEmail.split('@')[1];
  if (!domain) return;

  const domainCheck = canSendToDomain(domain, campaign);
  if (!domainCheck.allowed) {
    const msg = domainCheck.reason.includes('minute') ? '10 seconds' : '5 minutes';
    console.warn(`[SEND-LIMITS] Domain ${domain} throttled (${domainCheck.reason}). Waiting ${msg}...`);
    await new Promise(r => setTimeout(r, domainCheck.reason.includes('minute') ? 10000 : 300000));
  }

  const accountEmail = recordEmail;
  const accountCheck = checkDailyAccountCap(accountEmail, campaign);
  if (!accountCheck.allowed) {
    console.warn(`[SEND-LIMITS] Account ${accountEmail} capped (${accountCheck.reason}). Waiting 5 minutes...`);
    await new Promise(r => setTimeout(r, 300000));
  }
}

export function isBounced(email) {
  if (!_db) return false;
  const row = _db.prepare('SELECT id FROM bounce_tracker WHERE email = ? AND suppressed = 1').get(email);
  return !!row;
}

export function recordBounce(email, bounceType = 'hard', campaign = 'main') {
  if (!_db) return;
  const domain = email.split('@')[1] || 'unknown';
  const existing = _db.prepare('SELECT id, count FROM bounce_tracker WHERE email = ?').get(email);
  if (existing) {
    _db.prepare('UPDATE bounce_tracker SET count = count + 1, last_seen = datetime(\'now\'), bounce_type = ? WHERE id = ?').run(bounceType, existing.id);
    if (bounceType === 'hard' || existing.count >= 3) {
      _db.prepare('UPDATE bounce_tracker SET suppressed = 1 WHERE id = ?').run(existing.id);
      _db.prepare('UPDATE email_records SET excluded = 1 WHERE email = ?').run(email);
      console.warn(`[BOUNCE] Suppressed ${email} (${bounceType}, count: ${existing.count + 1})`);
    }
  } else {
    _db.prepare('INSERT INTO bounce_tracker (email, target_domain, bounce_type, campaign, suppressed) VALUES (?, ?, ?, ?, ?)').run(email, domain, bounceType, campaign, bounceType === 'hard' ? 1 : 0);
    if (bounceType === 'hard') {
      _db.prepare('UPDATE email_records SET excluded = 1 WHERE email = ?').run(email);
      console.warn(`[BOUNCE] Hard bounce — suppressed ${email}`);
    }
  }
}

export default { initSendLimits, canSendToDomain, checkDailyAccountCap, enforceDelay, isBounced, recordBounce };
