import axios from 'axios';

const MAILGUARD_URL = process.env.MAILGUARD_URL || 'http://localhost:8001';

/**
 * Verify email via local mailguard API (9-layer verification)
 * Returns: { valid, reason, score, verdict, ... }
 */
export async function verifyViaMailguard(email, options = {}) {
  try {
    const response = await axios.post(
      `${MAILGUARD_URL}/validate`,
      {
        email: email,
        check_smtp: options.check_smtp || false,
        check_catchall: options.check_catchall || false,
        timeout: options.timeout || 10.0,
      },
      { timeout: 15000 }
    );

    const data = response.data;

    return {
      valid: data.is_valid,
      reason: data.reason || data.verdict,
      score: data.score / 100, // Normalize to 0-1
      verdict: data.verdict,
      syntax_ok: data.syntax_ok,
      mx_ok: data.mx_ok,
      disposable: data.disposable,
      role_based: data.role_based,
      free_provider: data.free_provider,
      catch_all: data.catch_all,
      smtp_ok: data.smtp_ok,
      typo_suggestion: data.typo_suggestion,
      domain: data.domain,
      email_type: data.email_type,
      _definitive: data.score >= 70, // High confidence = definitive
      _hardBounce: data.verdict === 'undeliverable' && data.score <= 10,
    };
  } catch (err) {
    console.warn(`[MAILGUARD] Verification failed for ${email}: ${err.message}`);
    return null; // Fall back to next provider
  }
}
