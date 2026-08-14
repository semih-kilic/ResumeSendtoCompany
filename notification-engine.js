import { EventEmitter } from 'events';

const SEVERITY = { INFO: 'info', WARN: 'warn', ERROR: 'error', CRITICAL: 'critical' };

const DEFAULT_THRESHOLDS = {
  dlq_size: 50,
  provider_consecutive_failures: 5,
  retry_exhaustion_alert: true,
};

const DEDUP_WINDOW_MS = 5 * 60 * 1000;

export class NotificationEngine extends EventEmitter {
  constructor(db, config = {}) {
    super();
    this.db = db;
    this.config = config;
    this.enabled = config.notifications_enabled === true;
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...config.alert_thresholds };
    this._providerFailureCounts = new Map();
    this._dlqWarned = false;
    this._pollTimer = null;
    this._recentNotifications = new Map();
  }

  _isDuplicate(dedupKey) {
    const last = this._recentNotifications.get(dedupKey);
    if (last && Date.now() - last < DEDUP_WINDOW_MS) return true;
    this._recentNotifications.set(dedupKey, Date.now());
    return false;
  }

  start() {
    if (!this.enabled) {
      console.info('[NOTIFICATION-ENGINE] Disabled by config');
      return;
    }
    console.info('[NOTIFICATION-ENGINE] Started');
    this._pollTimer = setInterval(() => this._poll(), 60000);
    this._poll();
  }

  stop() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    console.info('[NOTIFICATION-ENGINE] Stopped');
  }

  async _poll() {
    try {
      await this._checkDLQSize();
    } catch (e) {
      console.error('[NOTIFICATION-ENGINE] Poll error:', e.message);
    }
  }

  async _checkDLQSize() {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM dead_letter_queue').get();
    const size = row?.count || 0;

    if (size >= this.thresholds.dlq_size && !this._dlqWarned) {
      this._dlqWarned = true;
      await this.emitNotification('dlq_threshold', SEVERITY.WARN, 'DLQ Size Threshold Reached', `${size} items in Dead Letter Queue (threshold: ${this.thresholds.dlq_size})`, { dlqSize: size, threshold: this.thresholds.dlq_size });
    } else if (size < this.thresholds.dlq_size) {
      this._dlqWarned = false;
    }
  }

  async emitNotification(type, severity, title, message, metadata = {}) {
    const notification = { type, severity, title, message, metadata: JSON.stringify(metadata), created_at: new Date().toISOString(), read: 0 };

    try {
      this.db.prepare(`
        INSERT INTO notifications (type, severity, title, message, metadata, created_at, read)
        VALUES (@type, @severity, @title, @message, @metadata, @created_at, @read)
      `).run(notification);
      notification.id = this.db.prepare('SELECT last_insert_rowid() as id').get().id;
    } catch (e) {
      console.error('[NOTIFICATION-ENGINE] DB insert failed:', e.message);
    }

    this.emit('notification', notification);

    if (this.config.notification_email) {
      await this._sendEmailAlert(notification);
    }

    if (this.config.webhook_url) {
      await this._sendWebhookAlert(notification);
    }

    return notification;
  }

  async providerFailed(provider, reason, status) {
    if (!this.enabled) return;

    const dedupKey = `failed:${provider}`;
    if (this._isDuplicate(dedupKey)) return;

    const key = `${provider}:${reason}`;
    const count = (this._providerFailureCounts.get(key) || 0) + 1;
    this._providerFailureCounts.set(key, count);

    await this.emitNotification('provider_disabled', count >= this.thresholds.provider_consecutive_failures ? SEVERITY.ERROR : SEVERITY.WARN, `Provider Disabled: ${provider}`, `${provider} failed (reason=${reason}, status=${status}). Disabled for cooldown period.`, { provider, reason, status, failureCount: count });
  }

  async providerRecovered(provider) {
    if (!this.enabled) return;

    const dedupKey = `recovered:${provider}`;
    if (this._isDuplicate(dedupKey)) return;

    this._providerFailureCounts.delete(provider);
    await this.emitNotification('provider_recovered', SEVERITY.INFO, `Provider Recovered: ${provider}`, `${provider} is healthy again after cooldown.`, { provider });
  }

  async dlqRetryFailed(itemId, retryCount, maxRetries, errorMessage) {
    if (!this.enabled) return;

    const isExhausted = retryCount >= maxRetries;
    await this.emitNotification(
      isExhausted ? 'email_exhausted' : 'retry_failed',
      isExhausted ? SEVERITY.ERROR : SEVERITY.WARN,
      isExhausted ? `Email Exhausted After ${maxRetries} Retries` : `DLQ Retry Failed (${retryCount}/${maxRetries})`,
      `Item ${itemId}: ${errorMessage}`,
      { itemId, retryCount, maxRetries, error: errorMessage }
    );
  }

  async allProvidersExhausted(service, fallback) {
    if (!this.enabled) return;

    await this.emitNotification('all_providers_exhausted', SEVERITY.CRITICAL, `All Providers Exhausted: ${service}`, `Falling back to ${fallback || 'graceful degradation'}`, { service, fallback });
  }

  async _sendEmailAlert(notification) {
    try {
      const { Resend } = await import('resend');
      const resend = new Resend(this.config.resend_api_key?.trim());
      await resend.emails.send({
        from: this.config.resend_from_email || 'notifications@cyber-sec-pro.com',
        to: this.config.notification_email,
        subject: `[${notification.severity.toUpperCase()}] ${notification.title}`,
        html: `<h2>${notification.title}</h2><p>${notification.message}</p><pre>${JSON.stringify(JSON.parse(notification.metadata || '{}'), null, 2)}</pre><hr><p><small>Sent at ${new Date(notification.created_at).toISOString()}</small></p>`,
      });
    } catch (e) {
      console.error('[NOTIFICATION-ENGINE] Email alert failed:', e.message);
    }
  }

  async _sendWebhookAlert(notification) {
    try {
      const axios = (await import('axios')).default;
      await axios.post(this.config.webhook_url, {
        event: 'notification',
        type: notification.type,
        severity: notification.severity,
        title: notification.title,
        message: notification.message,
        metadata: JSON.parse(notification.metadata || '{}'),
        ts: notification.created_at,
      }, { timeout: 10000 });
    } catch (e) {
      console.error('[NOTIFICATION-ENGINE] Webhook alert failed:', e.message);
    }
  }

  getNotifications({ page = 1, limit = 50, unreadOnly = false } = {}) {
    let where = '';
    if (unreadOnly) where = 'WHERE read = 0';
    const offset = (page - 1) * limit;
    const total = this.db.prepare(`SELECT COUNT(*) as count FROM notifications ${where}`).get().count;
    const records = this.db.prepare(`SELECT * FROM notifications ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(limit, offset);
    return { records, total, page, limit, totalPages: Math.ceil(total / limit), unread: this.db.prepare('SELECT COUNT(*) as count FROM notifications WHERE read = 0').get().count };
  }

  markRead(id) {
    this.db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(id);
  }

  markAllRead() {
    this.db.prepare('UPDATE notifications SET read = 1 WHERE read = 0').run();
  }

  getUnreadCount() {
    return this.db.prepare('SELECT COUNT(*) as count FROM notifications WHERE read = 0').get().count;
  }
}

export default NotificationEngine;
