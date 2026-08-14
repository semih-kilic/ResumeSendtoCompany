/**
 * 🗄️ DATABASE SCHEMA ENHANCEMENTS
 * 
 * Add tracking tables for:
 * - Outreach campaign logs
 * - Email delivery tracking
 * - SMTP provider health
 * - Anti-detection metrics
 */

export const SCHEMA_ENHANCEMENTS = `

-- ==================== OUTREACH TRACKING ====================

CREATE TABLE IF NOT EXISTS outreach_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  sender_email TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  subject TEXT NOT NULL,
  body_preview TEXT,
  status TEXT DEFAULT 'sent', -- sent, bounced, opened, clicked, replied, failed
  provider_used TEXT,
  message_id TEXT UNIQUE,
  bounce_code TEXT,
  bounce_reason TEXT,
  opened_at DATETIME,
  clicked_at DATETIME,
  replied_at DATETIME,
  reply_content TEXT,
  spam_score REAL,
  
  FOREIGN KEY(company_id) REFERENCES companies(id),
  INDEX idx_company_status (company_id, status),
  INDEX idx_sent_at (sent_at),
  INDEX idx_recipient (recipient_email),
  INDEX idx_status (status)
);

-- ==================== DEDUPLICATION ====================

CREATE TABLE IF NOT EXISTS outreach_dedup (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL UNIQUE,
  last_contact_date DATETIME,
  contact_count INTEGER DEFAULT 1,
  last_response TEXT,
  
  FOREIGN KEY(company_id) REFERENCES companies(id)
);

-- ==================== CAMPAIGN TRACKING ====================

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME,
  ended_at DATETIME,
  status TEXT DEFAULT 'planning', -- planning, running, paused, completed
  total_contacts INTEGER DEFAULT 0,
  emails_sent INTEGER DEFAULT 0,
  emails_delivered INTEGER DEFAULT 0,
  emails_bounced INTEGER DEFAULT 0,
  emails_opened INTEGER DEFAULT 0,
  emails_clicked INTEGER DEFAULT 0,
  emails_replied INTEGER DEFAULT 0,
  avg_open_rate REAL,
  avg_click_rate REAL,
  avg_reply_rate REAL,
  target_daily_volume INTEGER DEFAULT 100,
  actual_daily_volume INTEGER DEFAULT 0,
  
  INDEX idx_status (status),
  INDEX idx_created_at (created_at)
);

-- ==================== SMTP PROVIDER HEALTH ====================

CREATE TABLE IF NOT EXISTS smtp_provider_health (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_name TEXT UNIQUE NOT NULL,
  last_used DATETIME,
  messages_sent INTEGER DEFAULT 0,
  messages_bounced INTEGER DEFAULT 0,
  messages_failed INTEGER DEFAULT 0,
  health_score REAL DEFAULT 100,
  is_enabled BOOLEAN DEFAULT 1,
  cooldown_until DATETIME,
  notes TEXT,
  
  INDEX idx_health_score (health_score),
  INDEX idx_enabled (is_enabled)
);

-- ==================== ANTI-DETECTION METRICS ====================

CREATE TABLE IF NOT EXISTS anti_detection_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  user_agent_rotations INTEGER DEFAULT 0,
  proxy_rotations INTEGER DEFAULT 0,
  delay_avg_ms INTEGER DEFAULT 0,
  blocked_detections INTEGER DEFAULT 0,
  captcha_encounters INTEGER DEFAULT 0,
  rate_limit_hits INTEGER DEFAULT 0,
  bot_detection_hits INTEGER DEFAULT 0,
  proxy_failures INTEGER DEFAULT 0,
  
  INDEX idx_recorded_at (recorded_at)
);

-- ==================== FAILED EMAIL QUEUE ====================

CREATE TABLE IF NOT EXISTS failed_email_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_preview TEXT,
  error_reason TEXT,
  first_attempt DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_attempt DATETIME,
  retry_count INTEGER DEFAULT 0,
  next_retry DATETIME,
  status TEXT DEFAULT 'pending', -- pending, retrying, abandoned
  
  FOREIGN KEY(company_id) REFERENCES companies(id),
  INDEX idx_status (status),
  INDEX idx_next_retry (next_retry)
);

-- ==================== REQUEST PATTERN TRACKING ====================

CREATE TABLE IF NOT EXISTS request_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL,
  recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  request_count INTEGER DEFAULT 0,
  avg_delay_ms INTEGER DEFAULT 0,
  last_request DATETIME,
  blocked_count INTEGER DEFAULT 0,
  success_rate REAL,
  
  UNIQUE(domain, recorded_at),
  INDEX idx_domain (domain),
  INDEX idx_recorded_at (recorded_at)
);

-- ==================== EMAIL TEMPLATES ====================

CREATE TABLE IF NOT EXISTS email_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  category TEXT, -- cv_track, saas_track, generic
  subject_template TEXT NOT NULL,
  body_template TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT 1,
  
  INDEX idx_category (category),
  INDEX idx_is_active (is_active)
);

-- ==================== CONTACT HISTORY ====================

CREATE TABLE IF NOT EXISTS contact_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  company_website TEXT,
  company_industry TEXT,
  company_size TEXT,
  hiring_score REAL,
  last_contacted DATETIME,
  contact_count INTEGER DEFAULT 0,
  response_status TEXT, -- no_response, interested, rejected, bounced
  notes TEXT,
  
  FOREIGN KEY(company_id) REFERENCES companies(id),
  INDEX idx_company (company_id),
  INDEX idx_last_contacted (last_contacted),
  INDEX idx_hiring_score (hiring_score)
);

-- ==================== STATISTICS SNAPSHOT ====================

CREATE TABLE IF NOT EXISTS daily_statistics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date DATE UNIQUE NOT NULL,
  emails_sent INTEGER DEFAULT 0,
  emails_delivered INTEGER DEFAULT 0,
  emails_bounced INTEGER DEFAULT 0,
  emails_opened INTEGER DEFAULT 0,
  emails_clicked INTEGER DEFAULT 0,
  emails_replied INTEGER DEFAULT 0,
  api_calls_made INTEGER DEFAULT 0,
  api_failures INTEGER DEFAULT 0,
  scraped_companies INTEGER DEFAULT 0,
  new_contacts_found INTEGER DEFAULT 0,
  system_uptime_pct REAL DEFAULT 100,
  avg_response_time_ms INTEGER DEFAULT 0,
  
  INDEX idx_date (date)
);

-- ==================== ALERTS & NOTIFICATIONS ====================

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  alert_type TEXT NOT NULL, -- rate_limit, blockage, failure, quota, health
  severity TEXT DEFAULT 'info', -- info, warning, critical
  title TEXT NOT NULL,
  description TEXT,
  action_required BOOLEAN DEFAULT 0,
  resolved_at DATETIME,
  
  INDEX idx_alert_type (alert_type),
  INDEX idx_severity (severity),
  INDEX idx_resolved_at (resolved_at)
);

`;

/**
 * Initialize database schema
 */
export async function initializeSchema(db) {
  try {
    const statements = SCHEMA_ENHANCEMENTS.split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const statement of statements) {
      await db.run(statement);
    }

    console.log('✅ Database schema initialized successfully');
    return true;
  } catch (error) {
    console.error('❌ Error initializing schema:', error);
    return false;
  }
}

export default { SCHEMA_ENHANCEMENTS, initializeSchema };
