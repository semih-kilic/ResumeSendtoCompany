/**
 * DLQ Retry Scheduler
 * Automatically retries failed emails from the SQLite-backed DLQ every 5 minutes
 * Implements exponential backoff and max retry limits
 */
export class DLQRetryScheduler {
  constructor(db, sendEngine, config = {}) {
    this.db = db;
    this.sendEngine = sendEngine;
    this.maxRetries = config.max_retries || 3;
    this.retryIntervalMs = (config.retry_interval_secs || 300) * 1000; // Default 5 minutes
    this.maxBackoffMs = (config.max_backoff_secs || 3600) * 1000; // Default 1 hour
    this.isRunning = false;
    this.timerId = null;
    this.retryStats = {
      totalRetried: 0,
      totalSucceeded: 0,
      totalFailed: 0,
      totalExhausted: 0,
    };
    this._cleanupIntervalMs = (config.cleanup_interval_secs || 86400) * 1000; // Default 24h
    this._lastCleanup = 0;
  }

  /**
   * Start the retry scheduler
   */
  start() {
    if (this.isRunning) {
      console.warn('[DLQ-RETRY-SCHEDULER] Already running');
      return;
    }

    this.isRunning = true;
    console.info(`[DLQ-RETRY-SCHEDULER] Started (interval: ${this.retryIntervalMs / 1000}s)`);

    // Run immediately, then schedule recurring retries
    this._runRetryLoop();
  }

  /**
   * Stop the retry scheduler
   */
  stop() {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    
    console.info('[DLQ-RETRY-SCHEDULER] Stopped');
  }

  /**
   * Execute retry loop
   */
  async _runRetryLoop() {
    try {
      if (!this.isRunning) return;

      await this._processDLQBatch();
      await this._runScheduledCleanup();

      // Schedule next retry
      this.timerId = setTimeout(() => this._runRetryLoop(), this.retryIntervalMs);
    } catch (e) {
      console.error(`[DLQ-RETRY-SCHEDULER] Error in retry loop: ${e.message}`);
      if (this.isRunning) {
        this.timerId = setTimeout(() => this._runRetryLoop(), this.retryIntervalMs);
      }
    }
  }

  async _runScheduledCleanup() {
    try {
      const now = Date.now();
      if (now - this._lastCleanup < this._cleanupIntervalMs) return;
      this._lastCleanup = now;

      // Purge items older than 30 days
      const purgeBefore = `datetime('now', '-30 days')`;
      const info = this.db.prepare(`DELETE FROM dead_letter_queue WHERE created_at < ${purgeBefore}`).run();
      if (info.changes > 0) {
        console.info(`[DLQ-CLEANUP] Purged ${info.changes} items older than 30 days`);
      }
    } catch (e) {
      console.error(`[DLQ-CLEANUP] Error: ${e.message}`);
    }
  }

  /**
   * Process a batch of DLQ items
   */
  async _processDLQBatch() {
    try {
      // Query DLQ for items ready for retry
      const dlqItems = this.db
        .prepare(`
          SELECT id, queue_name, item_data, retry_count, error_message, failed_at, created_at
          FROM dead_letter_queue
          WHERE retry_count < ?
          ORDER BY created_at ASC
          LIMIT 10
        `)
        .all(this.maxRetries);

      if (dlqItems.length === 0) {
        return;
      }

      console.info(`[DLQ-RETRY-SCHEDULER] Processing ${dlqItems.length} items from DLQ`);

      for (const item of dlqItems) {
        await this._retryItem(item);
      }

      const stats = this.getStats();
      console.info(
        `[DLQ-RETRY-SCHEDULER] Batch complete - Succeeded: ${stats.totalSucceeded}, ` +
        `Failed: ${stats.totalFailed}, Exhausted: ${stats.totalExhausted}`
      );
    } catch (e) {
      console.error(`[DLQ-RETRY-SCHEDULER] Error processing DLQ batch: ${e.message}`);
    }
  }

  /**
   * Retry a single DLQ item
   */
  async _retryItem(item) {
    try {
      const data = JSON.parse(item.item_data);
      const backoffMs = this._calculateBackoff(item.retry_count);
      const timeSinceFailure = Date.now() - new Date(item.failed_at).getTime();

      // Only retry if enough time has passed since last failure (backoff)
      if (timeSinceFailure < backoffMs) {
        return; // Not ready for retry yet
      }

      // Check if max retries exceeded
      if (item.retry_count >= this.maxRetries) {
        console.warn(
          `[DLQ-RETRY] Item ${item.id} exhausted (${item.retry_count}/${this.maxRetries} retries). ` +
          `Reason: ${item.error_message}`
        );
        this._markExhausted(item.id);
        this.retryStats.totalExhausted++;
        return;
      }

      // Attempt to resend
      this.retryStats.totalRetried++;
      console.info(
        `[DLQ-RETRY] Retrying item ${item.id} (attempt ${item.retry_count + 1}/${this.maxRetries})`
      );

      // Different handling based on queue type
      if (item.queue_name === 'send-dlq') {
        await this._retrySendEmail(item, data);
      } else {
        console.warn(`[DLQ-RETRY] Unknown queue type: ${item.queue_name}`);
      }
    } catch (e) {
      console.error(
        `[DLQ-RETRY] Error retrying item ${item.id}: ${e.message}`
      );
    }
  }

  /**
   * Retry sending an email
   */
  async _retrySendEmail(item, data) {
    try {
      const { to, subject, html, isTemplate, templateId, templateData, provider } = data;

      // Use the original provider if specified, otherwise let send-engine choose
      const sendOptions = {
        provider,
        retryCount: item.retry_count + 1,
        fromDLQ: true,
      };

      let result;
      if (isTemplate && templateId) {
        result = await this.sendEngine.sendTemplateEmail(to, templateId, templateData, sendOptions);
      } else {
        result = await this.sendEngine.sendPlainEmail(to, subject, html, sendOptions);
      }

      if (result.success) {
        console.info(`[DLQ-RETRY] Item ${item.id} resent successfully`);
        this._popFromDLQ(item.id);
        this.retryStats.totalSucceeded++;
      } else {
        // Update retry count for next attempt
        this._incrementRetry(item.id, result.error);
        this.retryStats.totalFailed++;
      }
    } catch (e) {
      console.error(`[DLQ-RETRY] Failed to resend email for item ${item.id}: ${e.message}`);
      this._incrementRetry(item.id, e.message);
      this.retryStats.totalFailed++;
    }
  }

  /**
   * Calculate exponential backoff (2^retryCount minutes, capped at maxBackoff)
   */
  _calculateBackoff(retryCount) {
    const baseMinutes = Math.pow(2, retryCount); // 1, 2, 4, 8, ... minutes
    const backoffMs = Math.min(baseMinutes * 60 * 1000, this.maxBackoffMs);
    return backoffMs;
  }

  /**
   * Remove item from DLQ (successful retry)
   */
  _popFromDLQ(itemId) {
    try {
      this.db.prepare('DELETE FROM dead_letter_queue WHERE id = ?').run(itemId);
    } catch (e) {
      console.error(`[DLQ-RETRY] Failed to remove item ${itemId} from DLQ: ${e.message}`);
    }
  }

  /**
   * Increment retry count for next attempt
   */
  _incrementRetry(itemId, errorMessage) {
    try {
      this.db.prepare(`
        UPDATE dead_letter_queue
        SET retry_count = retry_count + 1,
            error_message = ?,
            failed_at = datetime('now')
        WHERE id = ?
      `).run(errorMessage, itemId);
    } catch (e) {
      console.error(`[DLQ-RETRY] Failed to increment retry count for item ${itemId}: ${e.message}`);
    }
  }

  /**
   * Mark item as exhausted (move to terminal state)
   */
  _markExhausted(itemId) {
    try {
      this.db.prepare(`
        UPDATE dead_letter_queue
        SET retry_count = ?,
            error_message = 'Max retries exhausted',
            failed_at = datetime('now')
        WHERE id = ?
      `).run(this.maxRetries + 1, itemId);

      console.warn(`[DLQ-RETRY] Item ${itemId} marked exhausted and will not be retried`);
    } catch (e) {
      console.error(`[DLQ-RETRY] Failed to mark item ${itemId} as exhausted: ${e.message}`);
    }
  }

  /**
   * Retry specific items from DLQ (public API for manual retry)
   * @param {Array} items — list of DLQ row objects
   */
  async retryItems(items) {
    let retried = 0;
    for (const item of items) {
      try {
        await this._retryItem(item);
        retried++;
      } catch (e) {
        console.error(`[DLQ-RETRY] Error retrying item ${item.id}: ${e.message}`);
      }
    }
    return retried;
  }

  /**
   * Get retry statistics
   */
  getStats() {
    const totalItems = this.db.prepare('SELECT COUNT(*) as count FROM dead_letter_queue').get().count;
    const exhaustedItems = this.db
      .prepare('SELECT COUNT(*) as count FROM dead_letter_queue WHERE retry_count > ?')
      .get(this.maxRetries).count;

    return {
      ...this.retryStats,
      totalItemsInDLQ: totalItems,
      exhaustedItems,
      isRunning: this.isRunning,
    };
  }
}

export default DLQRetryScheduler;
