import dns from 'dns';
import { verifyViaMailguard } from './mailguard-verify.js';
import net from 'net';
import axios from 'axios';
import providerRegistry from './provider-registry.js';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
// Ensure data directory exists before opening SQLite database
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'canada.db');
const db = new Database(dbPath);

// Ensure domain_trust table exists (verifier opens its own connection)
db.exec(`
  CREATE TABLE IF NOT EXISTS domain_trust (
    domain       TEXT PRIMARY KEY,
    trust_score  REAL NOT NULL DEFAULT 0.5,
    last_checked TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
db.pragma('journal_mode = WAL');

// ─────────────────────────────────────────────────────────────────────
// Circuit breakers — one per provider (reset on process restart)
// ─────────────────────────────────────────────────────────────────────
const breaker = {
  abstractapi:       { disabled: false, failures: 0 },
  reoon:             { disabled: false, failures: 0 },
  mailboxvalidator:  { disabled: false, failures: 0 },
};
const FAILURE_THRESHOLD = 3;

function tripBreaker(provider) {
  if (!breaker[provider]) return;
  breaker[provider].failures++;
  if (breaker[provider].failures >= FAILURE_THRESHOLD) {
    breaker[provider].disabled = true;
    console.warn(`[VERIFIER] ${provider} circuit-breaker TRIPPED after ${FAILURE_THRESHOLD} failures — switching to next provider.`);
  }
}

function resetBreaker(provider) {
  if (!breaker[provider]) return;
  breaker[provider].failures = 0;
  breaker[provider].disabled = false;
}

// ─────────────────────────────────────────────────────────────────────
// Generic aliases — always rejected regardless of API results
// ─────────────────────────────────────────────────────────────────────
const GENERIC_ALIASES = new Set([
  'contact', 'info', 'admin', 'office', 'sales', 'support', 'aspa',
  'toimisto', 'postbox', 'mail', 'viesti', 'yhteys', 'posti',
  'kirjaamo', 'hello', 'helo'
]);

const RECRUITMENT_ALIASES = new Set([
  'hr', 'careers', 'jobs', 'rekry', 'talent', 'recruitment', 'recruiter', 'hiring'
]);

// Professional email patterns: 
// 1. firstname.lastname@
// 2. firstname@ (only if longer than 3 chars)
// 3. f.lastname@
// 4. firstname.l@
const PERSONAL_EMAIL_RE = /^([a-z\u00e4\u00f6\u00e50-9]{2,}\.[a-z\u00e4\u00f6\u00e50-9]{2,}|[a-z\u00e4\u00f6\u00e50-9]{3,}|[a-z0-9]{1}\.[a-z\u00e4\u00f6\u00e50-9]{2,}|[a-z\u00e4\u00f6\u00e50-9]{2,}\.[a-z0-9]{1})(@|$)/i;

// ─────────────────────────────────────────────────────────────────────
// Main verifyEmail — Fallback Chain
// Chain: Domain Trust → MX check → Provider APIs → MX-only fallback
// ─────────────────────────────────────────────────────────────────────
export async function verifyEmail(email, config = {}, timeoutMs = 5000) {
  console.log(`[VERIFY-ENTRY] ${email} allowGeneric=${config.allowGeneric}`);
  if (!email || !email.includes('@')) return { valid: false, reason: 'Invalid syntax' };

  const [local, domain] = email.split('@');
  const vConfig = config.verification || {};

  // ── 0. Generic alias — always rejected (unless allowGeneric is true) ─────────────
  const localLower = local.toLowerCase().trim();
  const isGeneric = GENERIC_ALIASES.has(localLower);
  if (isGeneric && !config.allowGeneric) {
    return { valid: false, reason: 'Generic alias blocked (Shield Mode)', confidence: 0.1 };
  }

  // ── 0.5 Smart API Bypass (Save Credits but Keep SaaS Leads) ───────
  // If it's not a personal email (john.doe@) and not a recruitment alias (hr@),
  // we do NOT want to waste paid Reoon API credits on it.
  // HOWEVER, the SaaS engine still needs 'info@' or 'sales@'.
  // Solution: Do a free local MX check for them and return immediately.
  const isPersonal = PERSONAL_EMAIL_RE.test(localLower);
  const isRecruitment = RECRUITMENT_ALIASES.has(localLower);
  
  if (!isPersonal && !isRecruitment && (!isGeneric || config.allowGeneric)) {
    console.log(`[MAILGUARD-PRE] ${email} entering mailguard block`);
    try {
      console.log(`[MAILGUARD-CALL] Calling verifyViaMailguard for ${email}...`);
      const mgResult = await verifyViaMailguard(email, { check_smtp: false, timeout: 10.0 });
      console.log(`[MAILGUARD-RESULT] ${email} → ${JSON.stringify(mgResult)}`);
      if (mgResult && (mgResult._definitive || mgResult.valid)) {
        return {
          valid: mgResult.valid,
          reason: `Mailguard: ${mgResult.reason} (score: ${Math.round((mgResult.score || 0) * 100)})`,
          score: mgResult.score,
          confidence: mgResult.valid ? 0.8 : 0.9,
        };
      }
    } catch (e) {
      console.log(`[MAILGUARD-ERROR] ${email}: ${e.message}`);
    }
    try {
      const mx = await resolveMx(domain);
      if (mx && mx.length > 0) {
        return { valid: true, reason: 'Local MX Check (Mailguard unavailable)', confidence: 0.4 };
      }
    } catch {
      return { valid: false, reason: 'Local MX Check Failed', confidence: 0.1 };
    }
    return { valid: false, reason: 'No MX Records', confidence: 0.1 };
  }

  // ── 1. Domain Trust Cache ──────────────────────────────────────────
  const trust = db.prepare('SELECT * FROM domain_trust WHERE domain = ?').get(domain);

  if (trust) {
    if (trust.trust_score === -1) {
      return { valid: false, reason: 'Domain Blacklisted (Shield Mode)', confidence: 1.0 };
    }
    if (trust.trust_score >= 0.8) {
      try { await resolveMx(domain); } catch {
        return { valid: false, reason: 'MX Failure on Trusted Domain' };
      }
      return { valid: true, reason: 'Domain Trusted (Cache Hit)', confidence: trust.trust_score };
    }
  }

  // ── 2. MX Check (always free) ──────────────────────────────────────
  let mxRecords;
  try {
    mxRecords = await resolveMx(domain);
  } catch {
    console.log(`[VERIFY-MX] ${email} → No MX records (catch)`);
    return { valid: false, reason: `No MX records found for ${domain}` };
  }
  if (!mxRecords || mxRecords.length === 0) {
    console.log(`[VERIFY-MX] ${email} → No MX records`);
    return { valid: false, reason: `No MX records found for ${domain}` };
  }
  console.log(`[VERIFY-MX] ${email} → MX found: ${mxRecords.length} records`);

  // ── 2.5 Mailguard (local 9-layer verification — free, unlimited)
  try {
    console.log(`[MAILGUARD-2.5] ${email} calling mailguard...`);
    const mailguardResult = await verifyViaMailguard(email, {
      check_smtp: false,
      check_catchall: false,
      timeout: 10.0,
    });
    console.log(`[MAILGUARD-2.5] ${email} result: ${JSON.stringify({ verdict: mailguardResult?.verdict, score: mailguardResult?.score, definitive: mailguardResult?._definitive, valid: mailguardResult?.valid, reason: mailguardResult?.reason })}`);
    if (mailguardResult && mailguardResult._definitive) {
      if (mailguardResult.valid) {
        updateDomainTrust(domain, 0.9);
        return {
          valid: true,
          reason: `Mailguard: ${mailguardResult.reason} (score: ${Math.round(mailguardResult.score * 100)})`,
          score: mailguardResult.score,
        };
      } else if (mailguardResult._hardBounce) {
        updateDomainTrust(domain, (trust?.trust_score || 0) - 0.2);
        return {
          valid: false,
          reason: `Mailguard: ${mailguardResult.reason}`,
          confidence: 0.9,
        };
      }
    }
  } catch (e) {
    console.warn(`[MAILGUARD] Verification failed: ${e.message}`);
  }

  // ── 3. Provider API chain ─────────────────────────────────────────
  const primaryProvider = vConfig.provider || 'reoon';
  const fallbackProviders = Array.isArray(vConfig.fallback_providers)
    ? vConfig.fallback_providers
    : ['mailboxvalidator', 'mx-only'];

  const providerOrder = [primaryProvider, ...fallbackProviders].filter(
    (p, i, arr) => arr.indexOf(p) === i
  );


  for (const provider of providerOrder) {
    if (provider === 'mx-only') break; // handled below

    const key = provider === 'mailboxvalidator'
      ? vConfig.mailboxvalidator_key
      : vConfig.api_key;

    if (!key || breaker[provider]?.disabled || !providerRegistry.isAvailable(provider)) continue;

    let result;
    try {
      switch (provider) {
        case 'abstractapi':
          result = await verifyViaAbstractApi(email, key, timeoutMs);
          break;
        case 'reoon':
          result = await verifyViaReoon(email, key, timeoutMs);
          break;
        case 'mailboxvalidator':
          result = await verifyViaMailboxValidator(email, key, timeoutMs);
          break;
        default:
          continue;
      }
    } catch (err) {
      tripBreaker(provider);
      continue;
    }

    // Definitive answer from API
    if (result && result._definitive) {
      if (result.valid) {
        updateDomainTrust(domain, 0.9);
        resetBreaker(provider);
        providerRegistry.markSuccess(provider);
      } else if (result._hardBounce) {
        updateDomainTrust(domain, (trust?.trust_score || 0) - 0.2);
        providerRegistry.markFailure(provider, 0, 'hard_bounce');
      }
      delete result._definitive;
      delete result._hardBounce;
      return result;
    }

    // API gave uncertain result — try next provider
    if (result?._error) {
      tripBreaker(provider);
      // If the error was specifically an API key issue, we definitely want to skip this provider
      if (result.reason?.includes('API key') || result.reason?.includes('Invalid key')) {
        continue;
      }
    }
  }

  // ── 4. Final Fallback: DIY SMTP Handshake ─────────────────────────
  // If all APIs are uncertain or exhausted, we attempt a custom SMTP 
  // handshake to verify the mailbox existence directly (Our own 'DIY API').
  console.log(`[VERIFIER] [DIY-FALLBACK] Attempting SMTP Handshake for ${email}...`);
  const handshake = await verifyViaSmtpHandshake(email, Math.min(timeoutMs * 2, 10000));
  if (handshake.valid) {
    return {
      valid: true,
      reason: handshake.reason,
      confidence: 0.6
    };
  } else {
    // If the handshake failed due to connection/timeout issues (suggesting port 25 is blocked locally)
    // but we ALREADY verified in Step 2 that the domain has active MX records, we can soft-approve it.
    const isNetworkBlock = handshake.reason && (
      handshake.reason.includes('timeout') || 
      handshake.reason.includes('ECONNREFUSED') || 
      handshake.reason.includes('EADDRNOTAVAIL') ||
      handshake.reason.includes('ENETUNREACH')
    );
    
    if (isNetworkBlock && mxRecords && mxRecords.length > 0) {
      console.log(`[VERIFIER] [SOFT-APPROVE] Soft-approved ${email} (MX records exist, handshake blocked by network port 25)`);
      return {
        valid: true,
        reason: `Soft-approved: MX Active, Handshake Blocked (${handshake.reason})`,
        confidence: 0.4
      };
    }

    return {
      valid: false,
      reason: handshake.reason,
      confidence: 0.2
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Provider Implementations
// ─────────────────────────────────────────────────────────────────────

// ── AbstractAPI ───────────────────────────────────────────────────────
async function verifyViaAbstractApi(email, apiKey, timeoutMs) {
  try {
    const response = await axios.get('https://emailreputation.abstractapi.com/v1/', {
      params: { api_key: apiKey.trim(), email: email.trim() },
      timeout: timeoutMs
    });
    const data = response.data;
    const deliverability = data.email_deliverability || {};
    const quality = data.email_quality || {};

    if (deliverability.status === 'deliverable') {
      return { valid: true, reason: 'AbstractAPI: Deliverable', score: quality.score, _definitive: true };
    }
    if (deliverability.status === 'undeliverable') {
      return { valid: false, reason: `AbstractAPI: Undeliverable`, score: quality.score, _definitive: true, _hardBounce: true };
    }
    if (parseFloat(quality.score) >= 0.7) {
      return { valid: true, reason: `AbstractAPI: Risky but High Score`, score: quality.score, _definitive: true };
    }
    return null; // uncertain — try next provider
  } catch (err) {
    const status = err.response?.status;
    if (status === 401) {
      providerRegistry.markFailure('abstractapi', status, 'auth');
      return { valid: false, reason: 'AbstractAPI: Invalid key', _definitive: false, _error: true };
    }
    if (status === 402 || status === 422) {
      providerRegistry.markFailure('abstractapi', status, 'billing');
      console.warn(`[VERIFIER] AbstractAPI: Credits exhausted or account restricted (Status ${status}).`);
      return null; // Fallback
    }
    if (status === 429) {
      providerRegistry.markFailure('abstractapi', status, 'rate_limit');
      return null; // rate-limited — try next
    }
    providerRegistry.markFailure('abstractapi', status, 'unknown');
    return { _error: true };
  }
}

// ── Reoon Email Verifier ─────────────────────────────────────────────
// Docs: https://reoon.com/email-verification-api/
// Free: 1000/month, then ~$4/1000
// Statuses: "safe" | "risky" | "invalid" | "catch_all" | "disposable" | "unknown"
async function verifyViaReoon(email, apiKey, timeoutMs) {
  try {
    const response = await axios.get('https://emailverifier.reoon.com/api/v1/verify', {
      params: { email: email.trim(), key: apiKey.trim(), mode: 'power' },
      timeout: timeoutMs
    });
    const data = response.data;

    // Hard invalid — definitive bounce
    if (data.status === 'invalid' || data.is_valid_syntax === false) {
      return { valid: false, reason: 'Reoon: Invalid mailbox', _definitive: true, _hardBounce: true };
    }

    // Disposable / spam trap — always reject
    if (data.status === 'disposable' || data.is_spamtrap === true || data.is_disposable === true) {
      return { valid: false, reason: 'Reoon: Disposable/spamtrap', _definitive: true };
    }

    // Clean safe address
    if (data.status === 'safe' && data.is_safe_to_send === true) {
      return { valid: true, reason: `Reoon: Safe (score: ${data.overall_score})`, score: data.overall_score / 100, _definitive: true };
    }

    // catch_all domain — strictly reject in Zero-Tolerance mode to protect SMTP
    if (data.status === 'catch_all' || data.is_catch_all === true) {
      return { valid: false, reason: 'Reoon: Catch-all domain (Zero-Tolerance Block)', _definitive: true };
    }

    // Risky — accept if personal format or recruitment alias and score >= 50
    if (data.status === 'risky') {
      const [local] = email.split('@');
      const isPersonal = PERSONAL_EMAIL_RE.test(local);
      const isRecruitment = RECRUITMENT_ALIASES.has(local.toLowerCase().trim());

      if ((isPersonal || isRecruitment) && data.overall_score >= 50) {
        const type = isRecruitment ? 'recruitment' : 'personal';
        return { valid: true, reason: `Reoon: Risky but ${type} + score ${data.overall_score}`, score: data.overall_score / 100, _definitive: true };
      }
      return { valid: false, reason: `Reoon: Risky, score too low (${data.overall_score})`, _definitive: true };
    }

    // Unknown — fall through to next provider
    return null;
  } catch (err) {
  const status = err.response?.status;
  console.log(`[VERIFIER] Reoon Error Caught: Status ${status || 'unknown'}`);
  if (status === 401) {
    providerRegistry.markFailure('reoon', status, 'auth');
    return { valid: false, reason: 'Reoon: Invalid API key', _definitive: false, _error: true };
  }
  if (status === 403 || status === 402) {
    providerRegistry.markFailure('reoon', status, 'billing');
    tripBreaker('reoon');
    console.warn(`[VERIFIER] Reoon: Credits exhausted (Status ${status}). Falling back to next method...`);
    return null; // Force fallback
  }
  if (status === 429) {
    providerRegistry.markFailure('reoon', status, 'rate_limit');
    return null;
  }
  providerRegistry.markFailure('reoon', status, 'unknown');
  return { _error: true };
  }
}

// ── MailboxValidator ──────────────────────────────────────────────────
// Docs: https://www.mailboxvalidator.com/api-email-free
// Free: 100/month on free plan
async function verifyViaMailboxValidator(email, apiKey, timeoutMs) {
  try {
    const response = await axios.get('https://api.mailboxvalidator.com/v2/validation/single', {
      params: { key: apiKey.trim(), email: email.trim() },
      timeout: timeoutMs
    });
    const data = response.data;

    if (data.status !== undefined) {
      // status: "True" or "False"
      const isValid = String(data.status).toLowerCase() === 'true';
      if (isValid) {
        return { valid: true, reason: 'MailboxValidator: Valid', score: 0.85, _definitive: true };
      }
      if (data.is_valid === 'False' || data.is_smtp === 'False') {
        return { valid: false, reason: 'MailboxValidator: Invalid', _definitive: true, _hardBounce: true };
      }
    }
    return null; // uncertain
  } catch (err) {
  const status = err.response?.status;
  if (status === 401 || status === 403) {
    providerRegistry.markFailure('mailboxvalidator', status, 'auth');
    return { valid: false, reason: 'MailboxValidator: Invalid API key', _definitive: false, _error: true };
  }
  if (status === 429) {
    providerRegistry.markFailure('mailboxvalidator', status, 'rate_limit');
    return null;
  }
  providerRegistry.markFailure('mailboxvalidator', status, 'unknown');
  return { _error: true };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Domain Trust
// ─────────────────────────────────────────────────────────────────────
export function updateDomainTrust(domain, score) {
  try {
    const newScore = Math.max(-1.0, Math.min(1.0, score));
    db.prepare(`
      INSERT OR REPLACE INTO domain_trust (domain, trust_score, last_checked)
      VALUES (?, ?, datetime('now'))
    `).run(domain, newScore);
  } catch (e) {
    console.warn('Trust update failed:', e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────
function resolveMx(domain) {
  return new Promise((resolve, reject) => {
    dns.resolveMx(domain, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses);
    });
  });
}

/**
 * DIY SMTP Handshake Verifier
 * Connects to MX, sends MAIL FROM and RCPT TO to check mailbox existence.
 */
async function verifyViaSmtpHandshake(email, timeoutMs = 8000) {
  const [_local, domain] = email.split('@');
  try {
    const mxRecords = await resolveMx(domain);
    if (!mxRecords || mxRecords.length === 0) return { valid: false, reason: 'No MX records' };

    // Sort by priority (lowest number first)
    mxRecords.sort((a, b) => a.priority - b.priority);

    // Try MX hosts in order until one gives a definitive answer.
    for (const mx of mxRecords) {
      const targetMx = mx.exchange;
      const result = await new Promise((resolve) => {
        const socket = net.createConnection({ host: targetMx, port: 25 });
        socket.setTimeout(timeoutMs);

        let step = 0;
        let responseBuffer = '';

        const cleanup = () => {
          try { if (socket.writable) socket.write('QUIT\r\n'); } catch {}
          socket.destroy();
        };

        const finish = (valid, reason) => {
          cleanup();
          resolve({ valid, reason: `Handshake: ${reason}` });
        };

        socket.on('data', (data) => {
          responseBuffer += data.toString();
          if (!responseBuffer.includes('\r\n')) return;
          const lines = responseBuffer.trim().split('\r\n');
          const lastLine = lines[lines.length - 1];
          responseBuffer = '';

          const code = lastLine.substring(0, 3);

          if (code === '220' && step === 0) {
            socket.write(`HELO mail-verify.local\r\n`);
            step = 1;
          } else if (code.startsWith('2') && step === 1) {
            socket.write(`MAIL FROM:<noreply@mail-verify.local>\r\n`);
            step = 2;
          } else if (code.startsWith('2') && step === 2) {
            socket.write(`RCPT TO:<${email}>\r\n`);
            step = 3;
          } else if (step === 3) {
            if (code === '250' || code === '251') {
              finish(true, 'Mailbox exists');
            } else if (code === '550' || code === '551' || code === '553') {
              finish(false, `Mailbox rejected (${code})`);
            } else {
              finish(false, `Server response: ${lastLine}`);
            }
          } else if (code.startsWith('4') || code.startsWith('5')) {
            finish(false, `Server error: ${lastLine}`);
          }
        });

        socket.on('connect', () => {});
        socket.on('error', (err) => finish(false, `Connection failed: ${err.message}`));
        socket.on('timeout', () => finish(false, 'Connection timeout'));
      });

      // If we have a definitive result (true or hard false), return it.
      if (result && result.valid === true) return result;
      if (result && result.valid === false && result.reason && result.reason.includes('Mailbox rejected')) return result;
      // Otherwise try next MX host
    }

    // No MXs gave definitive rejection/accept — return a soft failure
    return { valid: false, reason: 'Handshake inconclusive on all MX hosts' };
  } catch (err) {
    return { valid: false, reason: `Handshake Error: ${err.message}` };
  }
}
