import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import toml from 'toml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULTS = {
  smtp_password: '',
  smtp_pool: [],
  webhook_url: '',
  verify_emails: true,
  smtp_from_name: 'Semih Kılıç',
  smtp_from_email: 'semihkilic@semihkilic.com',
  smtp_tls: true,
  tracking_base_url: '',
  saas_from_name: 'CyberSec Pro',
  saas_from_email: 'contact@cyber-sec-pro.com',
  saas_smtp_pool: [],
  saas_followup_days: 3,
  hot_lead_threshold: 3,
  email_subject: 'IT Systems Administrator – Open Application | Authorized to Work in Canada | Semih Kılıç',
  resume_path: './resume.pdf',
  // Resend HTTP API (resend.com) — used instead of SMTP when set
  resend_api_key: '',
  resend_from_email: '',
  resend_cooldown_secs: 900,
  smtp_pool_cooldown_mins: 60,
  scraping: {
    enable_dorking: true,
    max_concurrency: 5,
  },
  send_delay_secs: 72,
  concurrency: 20,
  request_timeout_secs: 10,
  domain_delay_ms: 1000,
  google_delay_secs: 5,
  linkedin_delay_secs: 3,
  scraperapi_key: '',
  openai_api_key: '',
  gemini_api_key: '',
  ai_personalization_enabled: true,
  // ai-job-search inspired: evaluate company fit before CV outreach
  job_fit_enabled: true,
  job_fit_min_score: 45,
  outreach_review_enabled: true,
  // Inbox reply monitor is disabled by default to avoid touching mailbox flags.
  reply_monitor_enabled: false,
  // SMTP warm-up sends emails between pool accounts. Keep disabled unless you want it.
  warmup_enabled: false,
  warmup: {
    enabled: false,
    ramp_up_days: 14,
    start_daily: 5,
    max_daily: 100,
    target_daily: 80,
    interval_mins: 15,
    exclude_domains: [],
  },
  sending_limits: {
    max_emails_per_account_per_day: 80,
    max_emails_per_domain_per_minute: 2,
    max_emails_per_domain_per_day: 20,
    cooldown_after_spam_error_mins: 120,
    ramp_up_days: 14,
  },
  saas_sending: {
    max_per_account_per_day: 100,
    max_per_domain_per_day: 30,
    ramp_up_days: 21,
    start_daily: 10,
    target_daily: 100,
  },
  // Prevent warm-up emails from ever targeting these addresses.
  warmup_exclude_emails: [],
  // Optional: send alerts/forwards to an operator inbox. Leave empty to disable.
  notification_email: '',
  notifications_enabled: false,
  alert_thresholds: {
    dlq_size: 50,
    provider_consecutive_failures: 5,
    retry_exhaustion_alert: true,
  },
  max_retries: 3,
  smart_selector: {
    quality_weight: 0.8,
    cost_weight: 0.2,
    lookback_hours: 24,
    refresh_interval_secs: 3600,
  },
  provider_groups: {
    web_scraping: { primary: 'scraperapi', fallbacks: ['scrapingbee', 'zenrows', 'stealth'], retry_on_failure: true },
    email_sending: { primary: 'resend', fallbacks: ['smtp'], retry_on_failure: true },
    email_verification: { primary: 'reoon', fallbacks: ['mailboxvalidator', 'abstractapi'], retry_on_failure: false },
    ai_services: { primary: 'gemini', fallbacks: ['openai'], retry_on_failure: true },
  },
  proxies: [],
  user_agents: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
  ]
};

export function loadConfig(configPath) {
  const fullPath = configPath || path.join(__dirname, 'config.toml');
  let fileConfig = {};
  
  try {
    if (fs.existsSync(fullPath)) {
      const raw = fs.readFileSync(fullPath, 'utf-8');
      fileConfig = toml.parse(raw);
    }
  } catch (e) {
    console.warn(`Warning: Could not parse config.toml: ${e.message}`);
  }

  const envConfig = {
    smtp_host: process.env.SMTP_HOST,
    smtp_port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined,
    smtp_username: process.env.SMTP_USERNAME,
    smtp_password: process.env.SMTP_PASSWORD,
    smtp_tls: process.env.SMTP_TLS ? process.env.SMTP_TLS === 'true' : undefined,

    smtp_from_name: process.env.SMTP_FROM_NAME,
    smtp_from_email: process.env.SMTP_FROM_EMAIL,

    webhook_url: process.env.WEBHOOK_URL,
    resend_api_key: process.env.RESEND_API_KEY,
    resend_from_email: process.env.RESEND_FROM_EMAIL,
    scraperapi_key: process.env.SCRAPERAPI_KEY,
    openai_api_key: process.env.OPENAI_API_KEY,
    gemini_api_key: process.env.GEMINI_API_KEY,
    saas_from_name: process.env.SAAS_FROM_NAME,
    saas_from_email: process.env.SAAS_FROM_EMAIL,
    notification_email: process.env.NOTIFICATION_EMAIL,
    notifications_enabled: process.env.NOTIFICATIONS_ENABLED ? process.env.NOTIFICATIONS_ENABLED === 'true' : undefined,

    verification: {
      ...(fileConfig.verification || {}),
      api_key: process.env.VERIFICATION_API_KEY || process.env.REOON_API_KEY || (fileConfig.verification ? fileConfig.verification.api_key : undefined),
      mailboxvalidator_key: process.env.MAILBOXVALIDATOR_KEY || (fileConfig.verification ? fileConfig.verification.mailboxvalidator_key : undefined),
    }
  };

  // Remove undefined so env doesn't overwrite with empties
  const cleanedEnvConfig = Object.fromEntries(
    Object.entries(envConfig).filter(([, v]) => v !== undefined)
  );

  // If verification table has no defined keys, drop it
  if (cleanedEnvConfig.verification) {
    const v = cleanedEnvConfig.verification;
    const hasAny = Object.values(v).some((x) => x !== undefined);
    if (!hasAny) delete cleanedEnvConfig.verification;
  }

  return { ...DEFAULTS, ...fileConfig, ...cleanedEnvConfig };
}

export function saveConfig(config, configPath) {
  const fullPath = configPath || path.join(__dirname, 'config.toml');
  
  const lines = [];
  const entries = Object.entries(config);
  
  // First pass: root level values
  for (const [key, value] of entries) {
    if (typeof value !== 'object' || value === null) {
      lines.push(`${key} = ${serializeValue(value)}`);
    } else if (Array.isArray(value) && (value.length === 0 || typeof value[0] !== 'object')) {
      lines.push(`${key} = ${serializeValue(value)}`);
    }
  }
  
  // Second pass: nested objects (tables) and array of tables
  for (const [key, value] of entries) {
    if (typeof value === 'object' && value !== null) {
      if (Array.isArray(value)) {
        if (value.length > 0 && typeof value[0] === 'object') {
          // Array of tables: [[key]]
          for (const item of value) {
            lines.push(`\n[[${key}]]`);
            for (const [subKey, subValue] of Object.entries(item)) {
              lines.push(`${subKey} = ${serializeValue(subValue)}`);
            }
          }
        }
        // Non-object arrays were handled in the first pass
      } else {
        // Nested table: [key]
        lines.push(`\n[${key}]`);
        for (const [subKey, subValue] of Object.entries(value)) {
          lines.push(`${subKey} = ${serializeValue(subValue)}`);
        }
      }
    }
  }
  
  fs.writeFileSync(fullPath, lines.join('\n'), 'utf-8');
}

function serializeValue(value) {
  if (typeof value === 'string') {
    return `"${value.replace(/\\/g, '\\\\')}"`;
  }
  if (Array.isArray(value)) {
    return `[${value.map(v => serializeValue(v)).join(', ')}]`;
  }
  return value;
}

export function maskPassword(config) {
  const maskedPool = (config.smtp_pool || []).map(p => ({ ...p, password: p.password ? '••••••••' : '' }));
  return {
    ...config,
    smtp_password: config.smtp_password ? '••••••••' : '',
    smtp_pool: maskedPool,
    resend_api_key: config.resend_api_key ? '••••••••' : '',
    verification: config.verification
      ? { ...config.verification, api_key: config.verification.api_key ? '••••••••' : '', mailboxvalidator_key: config.verification.mailboxvalidator_key ? '••••••••' : '' }
      : config.verification
  };
}
