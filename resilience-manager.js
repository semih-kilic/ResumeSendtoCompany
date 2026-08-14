/**
 * Resilience Manager — Circuit Breaker + Retry + Dead Letter Queue
 */

// ─── Circuit Breaker ────────────────────────────────────────────────────────
export class CircuitBreaker {
  constructor(name, { failureThreshold = 5, timeoutSecs = 300 } = {}) {
    this.name = name;
    this.failureThreshold = failureThreshold;
    this.timeoutMs = timeoutSecs * 1000;
    this.failures = 0;
    this.state = 'CLOSED'; // CLOSED | OPEN | HALF_OPEN
    this.openedAt = null;
  }

  recordSuccess() {
    this.failures = 0;
    if (this.state === 'HALF_OPEN') {
      console.log(`[CIRCUIT] ${this.name} recovered → CLOSED`);
    }
    this.state = 'CLOSED';
    this.openedAt = null;
  }

  recordFailure() {
    this.failures++;
    if (this.failures >= this.failureThreshold && this.state !== 'OPEN') {
      this.state = 'OPEN';
      this.openedAt = Date.now();
      console.warn(`[CIRCUIT] ${this.name} OPEN after ${this.failures} failures (reset in ${this.timeoutMs / 1000}s)`);
    }
  }

  isAvailable() {
    if (this.state === 'CLOSED') return true;
    if (this.state === 'OPEN') {
      if (Date.now() - this.openedAt >= this.timeoutMs) {
        this.state = 'HALF_OPEN';
        return true;
      }
      return false;
    }
    return true; // HALF_OPEN — allow one probe
  }

  async execute(fn, ...args) {
    if (!this.isAvailable()) {
      throw new Error(`Circuit breaker ${this.name} is OPEN`);
    }
    try {
      const result = await fn(...args);
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }
}

// ─── Retry Manager ──────────────────────────────────────────────────────────
export class RetryManager {
  constructor({ maxRetries = 3, initialDelayMs = 1000, backoffFactor = 2 } = {}) {
    this.maxRetries = maxRetries;
    this.initialDelayMs = initialDelayMs;
    this.backoffFactor = backoffFactor;
  }

  async execute(fn, ...args) {
    let lastError;
    let delay = this.initialDelayMs;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn(...args);
      } catch (err) {
        lastError = err;
        // Don't retry permanent errors
        const status = err.response?.status;
        if (status === 401 || status === 403 || status === 404) throw err;
        if (attempt < this.maxRetries) {
          // Add jitter to avoid thundering herd
          const jitter = Math.random() * 1000;
          await new Promise(r => setTimeout(r, delay + jitter));
          delay = Math.min(delay * this.backoffFactor, 30000);
        }
      }
    }
    throw lastError;
  }
}

// ─── Dead Letter Queue ──────────────────────────────────────────────────────
// In-memory DLQ — stores failed items for later retry
export class DeadLetterQueue {
  constructor(name, { maxSize = 1000 } = {}) {
    this.name = name;
    this.maxSize = maxSize;
    this.queue = [];
  }

  push(item, error) {
    if (this.queue.length >= this.maxSize) {
      this.queue.shift(); // Drop oldest
    }
    this.queue.push({
      item,
      error: error?.message || String(error),
      failedAt: new Date().toISOString(),
      retries: 0
    });
  }

  pop() {
    return this.queue.shift();
  }

  size() {
    return this.queue.length;
  }

  drain() {
    const items = [...this.queue];
    this.queue = [];
    return items;
  }
}

// ─── SQLite-Backed Dead Letter Queue ─────────────────────────────────────────
// Persistent DLQ for reliable message retry even after process restart
export class SqliteBackedDeadLetterQueue {
  constructor(db, name) {
    this.db = db;
    this.name = name;
  }

  /**
   * Push item to persistent DLQ
   * @param {object} item - The failed message (e.g., { email, campaign, ... })
   * @param {error|string} error - The error or error message
   */
  push(item, error) {
    const itemData = JSON.stringify(item);
    const errorMsg = error?.message || String(error || 'unknown');
    const failedAt = new Date().toISOString();

    try {
      this.db.prepare(`
        INSERT INTO dead_letter_queue (queue_name, item_data, error_message, retry_count, failed_at)
        VALUES (?, ?, ?, 0, ?)
      `).run(this.name, itemData, errorMsg, failedAt);
    } catch (e) {
      console.error(`[DLQ] Failed to push to SQLite DLQ: ${e.message}`);
    }
  }

  /**
   * Pop first item from DLQ (FIFO)
   * @returns {object} with structure { id, item, error, failedAt, retryCount }
   */
  pop() {
    try {
      const row = this.db.prepare(`
        SELECT id, item_data, error_message, retry_count, failed_at
        FROM dead_letter_queue
        WHERE queue_name = ?
        ORDER BY created_at ASC
        LIMIT 1
      `).get(this.name);

      if (!row) return null;

      // Delete from DB after popping
      this.db.prepare('DELETE FROM dead_letter_queue WHERE id = ?').run(row.id);

      return {
        id: row.id,
        item: JSON.parse(row.item_data),
        error: row.error_message,
        failedAt: row.failed_at,
        retryCount: row.retry_count
      };
    } catch (e) {
      console.error(`[DLQ] Failed to pop from SQLite DLQ: ${e.message}`);
      return null;
    }
  }

  /**
   * Get count of items in DLQ
   * @returns {number}
   */
  size() {
    try {
      const result = this.db.prepare(`
        SELECT COUNT(*) as count FROM dead_letter_queue WHERE queue_name = ?
      `).get(this.name);
      return result?.count || 0;
    } catch (e) {
      console.error(`[DLQ] Failed to get size from SQLite DLQ: ${e.message}`);
      return 0;
    }
  }

  /**
   * Drain all items from DLQ
   * @returns {array} of items
   */
  drain() {
    try {
      const rows = this.db.prepare(`
        SELECT id, item_data, error_message, retry_count, failed_at
        FROM dead_letter_queue
        WHERE queue_name = ?
        ORDER BY created_at ASC
      `).all(this.name);

      if (rows.length > 0) {
        const ids = rows.map(r => r.id);
        this.db.prepare(`DELETE FROM dead_letter_queue WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
      }

      return rows.map(r => ({
        id: r.id,
        item: JSON.parse(r.item_data),
        error: r.error_message,
        failedAt: r.failed_at,
        retryCount: r.retry_count
      }));
    } catch (e) {
      console.error(`[DLQ] Failed to drain SQLite DLQ: ${e.message}`);
      return [];
    }
  }

  /**
   * Increment retry count for an item (for tracking retries)
   * @param {number} id - Item DB id
   */
  incrementRetry(id) {
    try {
      this.db.prepare(`
        UPDATE dead_letter_queue SET retry_count = retry_count + 1 WHERE id = ?
      `).run(id);
    } catch (e) {
      console.error(`[DLQ] Failed to increment retry count: ${e.message}`);
    }
  }

  /**
   * Get stats about DLQ
   * @returns {object} with count and oldest_item_age
   */
  getStats() {
    try {
      const count = this.size();
      const oldest = this.db.prepare(`
        SELECT created_at FROM dead_letter_queue WHERE queue_name = ? ORDER BY created_at ASC LIMIT 1
      `).get(this.name);

      const oldestAge = oldest ? Math.round((Date.now() - new Date(oldest.created_at).getTime()) / 1000) : 0;

      return { count, oldestAgeSeconds: oldestAge };
    } catch (e) {
      console.error(`[DLQ] Failed to get stats: ${e.message}`);
      return { count: 0, oldestAgeSeconds: 0 };
    }
  }
}

// ─── Health Monitor ──────────────────────────────────────────────────────────
export class HealthMonitor {
  constructor() {
    this.providers = new Map();
  }

  record(provider, success) {
    if (!this.providers.has(provider)) {
      this.providers.set(provider, { success: 0, fail: 0, lastSeen: null });
    }
    const p = this.providers.get(provider);
    if (success) { p.success++; } else { p.fail++; }
    p.lastSeen = new Date().toISOString();
  }

  getStats(provider) {
    return this.providers.get(provider) || { success: 0, fail: 0 };
  }

  summary() {
    const out = {};
    for (const [k, v] of this.providers) out[k] = v;
    return out;
  }
}
