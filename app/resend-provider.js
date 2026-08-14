/**
 * Resend API helper: cooldown instead of permanent disable, verified from-address support.
 */
export class ResendProvider {
  constructor(config, logFn = () => {}) {
    this.config = config;
    this.log = logFn;
    this._disabledUntil = 0;
  }

  isAvailable() {
    const key = this.config.resend_api_key?.trim();
    if (!key) return false;

    if (this._disabledUntil && Date.now() >= this._disabledUntil) {
      this._disabledUntil = 0;
      this.log('info', '[RESEND] Cooldown expired — re-enabling Resend.');
    }

    return !this._disabledUntil || Date.now() >= this._disabledUntil;
  }

  /** Prefer resend_from_email (verified domain); fall back to campaign from email. */
  getFromAddress(campaign = 'job') {
    const verified = this.config.resend_from_email?.trim();
    const isSaas = campaign === 'saas';

    const name = isSaas
      ? (this.config.saas_from_name || this.config.smtp_from_name)
      : this.config.smtp_from_name;

    const fallbackEmail = isSaas
      ? (this.config.saas_from_email || this.config.smtp_from_email)
      : this.config.smtp_from_email;

    const email = verified || fallbackEmail;
    return {
      from: `${name} <${email}>`,
      replyTo: email,
    };
  }

  disableTemporary(reason, cooldownSecs) {
    const secs = cooldownSecs ?? this.config.resend_cooldown_secs ?? 900;
    this._disabledUntil = Date.now() + secs * 1000;
    this.log('warn', `[RESEND] Paused for ${secs}s (${reason}). Falling back to SMTP meanwhile.`);
  }

  /**
   * Interpret Resend API error.
   * @returns {'ok'|'retry'|'cooldown'}
   */
  classifyError(error) {
    if (!error) return 'ok';

    this.log('error', `[Resend] API Error: ${error.message} (Type: ${error.name})`);

    if (error.statusCode === 429) {
      this.disableTemporary('rate limit', 600);
      return 'cooldown';
    }

    if (error.statusCode === 401 || error.statusCode === 403) {
      this.disableTemporary('auth error');
      return 'cooldown';
    }

    if (error.message?.toLowerCase().includes('domain') || error.name === 'validation_error') {
      this.log('warn', '[RESEND] From/domain not verified — using SMTP. Set resend_from_email in config.');
      return 'retry';
    }

    return 'retry';
  }
}
