/**
 * ✨ CUSTOM EMAIL VERIFICATION SYSTEM
 * 
 * Completely self-contained, no 3rd party dependencies:
 * - DNS MX record validation (free)
 * - SMTP handshake verification (free)
 * - Regex pattern validation
 * - No external API calls
 * - Instant results
 */

import dns from 'dns';
import net from 'net';
import { promisify } from 'util';

const resolveMx = promisify(dns.resolveMx);

// Common disposable email domains to reject
const DISPOSABLE_DOMAINS = new Set([
  'tempmail.com', 'guerrillamail.com', '10minutemail.com', 'mailinator.com',
  'throwaway.email', 'temp-mail.org', 'sharklasers.com', 'mailnesia.com',
  'trash-mail.com', 'yopmail.com', 'trashmail.com', 'maildrop.cc'
]);

// Email pattern validation
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STRICT_EMAIL_REGEX = /^[a-zA-Z0-9._%-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

/**
 * Main verification function - No external dependencies
 * @param {string} email - Email to verify
 * @param {object} options - { timeout, checkMX, checkSMTP, checkDNS }
 * @returns {Promise<{ valid: bool, score: 0-1, reason: string, checks: object }>}
 */
export async function verifyEmailCustom(email, options = {}) {
  const {
    timeout = 5000,
    checkMX = true,
    checkSMTP = true,
    checkDNS = true
  } = options;

  const checks = {
    syntax: false,
    disposable: false,
    mxRecord: false,
    smtpConnect: false
  };

  let score = 0;
  let reasons = [];

  // 1. SYNTAX VALIDATION (instant)
  if (!EMAIL_REGEX.test(email)) {
    return { valid: false, score: 0, reason: 'Invalid email format', checks };
  }
  checks.syntax = true;
  score += 0.25;

  const [localPart, domain] = email.toLowerCase().split('@');

  // 2. CHECK DISPOSABLE DOMAIN (instant)
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { valid: false, score: 0.1, reason: 'Disposable email domain', checks };
  }
  checks.disposable = true;
  score += 0.1;

  // 3. DNS MX RECORD CHECK (free, fast)
  if (checkMX || checkDNS) {
    try {
      const mxRecords = await Promise.race([
        resolveMx(domain),
        new Promise((_, reject) => setTimeout(() => reject(new Error('DNS timeout')), timeout))
      ]);

      if (!mxRecords || mxRecords.length === 0) {
        return { 
          valid: false, 
          score: 0.3, 
          reason: 'Domain has no MX records', 
          checks 
        };
      }
      
      checks.mxRecord = true;
      score += 0.3;
    } catch (err) {
      // DNS might fail but domain could be valid (firewall, DNS censoring, etc)
      // Lower score but don't fail
      reasons.push(`DNS check failed: ${err.message}`);
      score += 0.15; // Partial credit
    }
  }

  // 4. SMTP HANDSHAKE VALIDATION (free, accurate)
  if (checkSMTP && checks.mxRecord) {
    try {
      const isValid = await verifySMTPHandshake(domain, localPart, timeout);
      if (isValid) {
        checks.smtpConnect = true;
        score += 0.3; // Highest confidence
      } else {
        reasons.push('SMTP handshake rejected (possible catch-all)');
        score += 0.2; // Still valid domain
      }
    } catch (err) {
      // SMTP check can fail for network reasons, don't hard fail
      reasons.push(`SMTP check timeout: ${err.message}`);
      score += 0.15;
    }
  }

  // FINAL DECISION
  const valid = score >= 0.55; // Threshold: needs syntax + disposable + some other check
  const reason = reasons.length > 0 
    ? reasons[0] 
    : (valid ? 'Email appears valid' : 'Email verification inconclusive');

  return {
    valid,
    score: Math.min(1, score),
    reason,
    checks
  };
}

/**
 * SMTP Handshake Verification
 * Connects to MX server and validates email without sending
 * @private
 */
async function verifySMTPHandshake(domain, localPart, timeout = 5000) {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const timer = setTimeout(() => {
      resolved = true;
      reject(new Error('SMTP timeout'));
    }, timeout);

    try {
      // Get MX records
      dns.resolveMx(domain, (err, addresses) => {
        if (err || !addresses || addresses.length === 0) {
          clearTimeout(timer);
          if (!resolved) {
            resolved = true;
            reject(new Error('No MX records'));
          }
          return;
        }

        // Try first MX server
        const mxHost = addresses[0].exchange;
        const socket = net.createConnection({ host: mxHost, port: 25, timeout });

        let stage = 0;
        let response = '';

        socket.on('data', (data) => {
          response += data.toString();

          if (stage === 0 && response.includes('220')) {
            // Server greeting received
            stage = 1;
            socket.write('EHLO localhost\r\n');
          } else if (stage === 1 && response.includes('250')) {
            // EHLO accepted
            stage = 2;
            socket.write(`MAIL FROM:<test@${domain}>\r\n`);
          } else if (stage === 2 && response.includes('250')) {
            // MAIL FROM accepted
            stage = 3;
            socket.write(`RCPT TO:<${localPart}@${domain}>\r\n`);
          } else if (stage === 3) {
            // Check RCPT response
            if (response.includes('250')) {
              // ✅ Email is valid
              clearTimeout(timer);
              socket.destroy();
              if (!resolved) {
                resolved = true;
                resolve(true);
              }
            } else if (response.includes('550') || response.includes('551') || response.includes('552')) {
              // ❌ Email rejected
              clearTimeout(timer);
              socket.destroy();
              if (!resolved) {
                resolved = true;
                resolve(false);
              }
            }
            // Else: keep waiting for more data
          }
        });

        socket.on('error', (err) => {
          clearTimeout(timer);
          if (!resolved) {
            resolved = true;
            reject(err);
          }
        });

        socket.on('close', () => {
          clearTimeout(timer);
          if (!resolved) {
            resolved = true;
            reject(new Error('Connection closed'));
          }
        });
      });
    } catch (err) {
      clearTimeout(timer);
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    }
  });
}

/**
 * Batch verification - verify multiple emails efficiently
 */
export async function verifyEmailBatch(emails, options = {}) {
  const results = [];
  const batchTimeout = options.batchTimeout || 10000; // 10s per 10 emails
  const concurrency = options.concurrency || 3; // Process 3 at a time

  const batches = [];
  for (let i = 0; i < emails.length; i += concurrency) {
    batches.push(emails.slice(i, i + concurrency));
  }

  for (const batch of batches) {
    const promises = batch.map(email =>
      Promise.race([
        verifyEmailCustom(email, options),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), batchTimeout)
        )
      ]).catch(err => ({
        email,
        valid: false,
        score: 0,
        reason: `Verification failed: ${err.message}`,
        checks: {}
      }))
    );

    const batchResults = await Promise.all(promises);
    results.push(...batchResults);
  }

  return results;
}

/**
 * Simplified version - just check if email is definitely INVALID
 * Fast, no async, used for initial filtering
 */
export function quickRejectEmail(email) {
  if (!email || typeof email !== 'string') return true;
  if (!EMAIL_REGEX.test(email)) return true;
  if (email.length > 254) return true; // RFC 5321

  const [, domain] = email.toLowerCase().split('@');
  if (DISPOSABLE_DOMAINS.has(domain)) return true;

  return false;
}

/**
 * Export for testing/debugging
 */
export const DEBUG = {
  DISPOSABLE_DOMAINS,
  EMAIL_REGEX,
  STRICT_EMAIL_REGEX
};
