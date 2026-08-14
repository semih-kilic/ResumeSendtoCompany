/**
 * 🚀 EMAIL ORCHESTRATION ENGINE
 * 
 * Core system that manages:
 * - Company queue batching
 * - SMTP provider selection & load balancing
 * - Rate limiting (anti-detection)
 * - Deduplication & prioritization
 * - Email personalization injection
 * - Delivery tracking & retry logic
 * 
 * This is the HEART of the job search automation engine
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import EventEmitter from 'events';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class EmailOrchestrationEngine extends EventEmitter {
  constructor(config = {}, db = null, logger = console) {
    super();
    this.config = config;
    this.db = db;
    this._log = logger;

    // Queue management
    this.queue = [];
    this.processingQueue = false;
    this.processedToday = new Set();
    this.failedEmails = [];
    this.successCount = 0;
    this.failCount = 0;

    // SMTP providers
    this.smtpPool = this._initializeSMTPPool(config);
    this.currentProviderIndex = 0;
    this.providerUsageCount = new Map();

    // Rate limiting
    this.lastEmailTime = {};
    this.minDelayMs = config.send_delay_secs ? (config.send_delay_secs * 1000) : 45000;
    this.perDomainDelay = config.domain_delay_ms || 1000;

    // Statistics
    this.stats = {
      emailsSentToday: 0,
      successCount: 0,
      failCount: 0,
      bounceCount: 0,
      openCount: 0,
      clickCount: 0,
      replyCount: 0,
      startTime: Date.now(),
    };

    this._log('info', '[ORCHESTRATION-ENGINE] Initialized successfully');
  }

  /**
   * Initialize SMTP providers from config
   */
  _initializeSMTPPool(config) {
    const pool = [];

    if (!config.smtp_pool || config.smtp_pool.length === 0) {
      this._log('warn', '[SMTP-POOL] No SMTP providers configured!');
      return pool;
    }

    for (const provider of config.smtp_pool) {
      try {
        const transporter = nodemailer.createTransport({
          host: provider.host,
          port: provider.port,
          secure: provider.tls !== false,
          auth: {
            user: provider.username,
            pass: provider.password,
          },
          pool: {
            maxConnections: 5,
            maxMessages: 100,
            rateDelta: 1000,
            rateLimit: 5,
          },
          connectionTimeout: 10000,
          socketTimeout: 10000,
        });

        pool.push({
          id: provider.id || `smtp-${pool.length}`,
          name: `${provider.username.split('@')[0]}@${provider.host}`,
          transporter,
          provider,
          enabled: true,
          messagesSent: 0,
          failures: 0,
          lastUsed: null,
          healthScore: 100,
        });

        this._log('info', `[SMTP-POOL] ✅ Added provider: ${pool[pool.length - 1].name}`);
      } catch (e) {
        this._log('error', `[SMTP-POOL] Failed to add provider: ${e.message}`);
      }
    }

    return pool;
  }

  /**
   * Select next SMTP provider (load-balanced, round-robin with health check)
   */
  _selectSMTPProvider() {
    if (this.smtpPool.length === 0) {
      this._log('error', '[SMTP-SELECT] No SMTP providers available!');
      return null;
    }

    // Find healthy providers
    let healthyProviders = this.smtpPool.filter(
      (p) => p.enabled && p.healthScore > 50
    );

    if (healthyProviders.length === 0) {
      this._log('warn', '[SMTP-SELECT] No healthy providers, using any available');
      healthyProviders = this.smtpPool.filter((p) => p.enabled);
    }

    if (healthyProviders.length === 0) {
      this._log('error', '[SMTP-SELECT] All providers disabled!');
      return null;
    }

    // Round-robin selection with load balancing
    const selectedProvider = healthyProviders[
      this.currentProviderIndex % healthyProviders.length
    ];
    this.currentProviderIndex++;

    return selectedProvider;
  }

  /**
   * Add companies to queue for outreach
   */
  async enqueueCompanies(companies) {
    if (!Array.isArray(companies)) {
      this._log('error', '[ENQUEUE] Invalid input: must be array');
      return false;
    }

    const deduped = this._deduplicateCompanies(companies);
    this.queue.push(...deduped);

    this._log('info', `[ENQUEUE] Added ${deduped.length} companies to queue (total: ${this.queue.length})`);
    return true;
  }

  /**
   * Deduplication - skip if already contacted
   */
  _deduplicateCompanies(companies) {
    return companies.filter((company) => {
      const key = `${company.company_name}|${company.contact_email}`;
      if (this.processedToday.has(key)) {
        return false;
      }
      this.processedToday.add(key);
      return true;
    });
  }

  /**
   * Prioritize queue (high-value targets first)
   */
  _prioritizeQueue() {
    this.queue.sort((a, b) => {
      // Higher hiring_score = higher priority
      const scoreA = a.hiring_score || 0;
      const scoreB = b.hiring_score || 0;
      return scoreB - scoreA;
    });
  }

  /**
   * Wait before sending next email (rate limiting)
   */
  async _applyRateLimiting(recipientEmail) {
    const domain = recipientEmail.split('@')[1];
    const now = Date.now();
    const lastTime = this.lastEmailTime[domain] || 0;
    const elapsed = now - lastTime;

    if (elapsed < this.perDomainDelay) {
      const waitMs = this.perDomainDelay - elapsed;
      this._log('debug', `[RATE-LIMIT] Waiting ${waitMs}ms for domain ${domain}`);
      await new Promise((r) => setTimeout(r, waitMs));
    }

    this.lastEmailTime[domain] = Date.now();

    // Global delay between emails
    await new Promise((r) => setTimeout(r, Math.random() * 1000 + 500));
  }

  /**
   * Build personalized email content
   */
  _buildEmailContent(company, template = 'default') {
    const subject = this._generateSubject(company);
    const body = this._generateBody(company);

    return { subject, body };
  }

  /**
   * Generate subject line with personalization
   */
  _generateSubject(company) {
    const templates = [
      `Quick Question about ${company.company_name}`,
      `Interested in joining ${company.company_name}`,
      `CV + Introduction - ${company.company_name}`,
      `Partnership Opportunity with ${company.company_name}`,
      `Hello from ${this.config.smtp_from_name}`,
    ];

    return templates[Math.floor(Math.random() * templates.length)];
  }

  /**
   * Generate personalized email body
   */
  _generateBody(company) {
    const name = company.contact_name || 'there';
    const companyName = company.company_name;
    const website = company.website;

    return `Hi ${name},

I've been impressed by what ${companyName} is doing${
      website ? ` at ${website}` : ''
    }.

I'm ${this.config.smtp_from_name}, an IT Systems Administrator with experience in infrastructure, cloud, and automation. I believe I could contribute to your team's success.

I'm attaching my CV for your review. Would be happy to discuss how I can add value to ${companyName}.

Best regards,
${this.config.smtp_from_name}
${this.config.smtp_from_email}`;
  }

  /**
   * Send single email
   */
  async _sendSingleEmail(company, senderProvider) {
    try {
      // Apply rate limiting
      await this._applyRateLimiting(company.contact_email);

      // Get email content
      const { subject, body } = this._buildEmailContent(company);

      // Prepare email
      const mailOptions = {
        from: `${this.config.smtp_from_name} <${this.config.smtp_from_email}>`,
        to: company.contact_email,
        subject,
        text: body,
        html: `<p>${body.replace(/\n/g, '<br>')}</p>`,
        // TODO: Add CV attachment
        // attachments: [{
        //   filename: 'cv.pdf',
        //   path: './data/resume.pdf'
        // }]
      };

      // Send via SMTP
      const result = await senderProvider.transporter.sendMail(mailOptions);

      // Track success
      this.stats.emailsSentToday++;
      this.stats.successCount++;
      senderProvider.messagesSent++;
      senderProvider.healthScore = Math.min(100, senderProvider.healthScore + 5);

      // Log to database
      if (this.db) {
        await this.db.run(
          `INSERT INTO outreach_logs 
           (company_id, sent_at, sender_email, recipient_email, subject, status, provider_used)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            company.id,
            new Date().toISOString(),
            this.config.smtp_from_email,
            company.contact_email,
            subject,
            'sent',
            senderProvider.name,
          ]
        );
      }

      this._log('info', `✅ [EMAIL-SENT] ${company.company_name} → ${company.contact_email}`);
      this.emit('email:sent', {
        company: company.company_name,
        recipient: company.contact_email,
        provider: senderProvider.name,
        timestamp: new Date(),
      });

      return { success: true, messageId: result.messageId };
    } catch (error) {
      this.stats.failCount++;
      senderProvider.failures++;
      senderProvider.healthScore = Math.max(0, senderProvider.healthScore - 10);

      this._log('error', `❌ [EMAIL-FAILED] ${company.company_name}: ${error.message}`);
      
      // Add to failed queue for retry
      this.failedEmails.push({
        company,
        error: error.message,
        timestamp: Date.now(),
        retries: 0,
      });

      this.emit('email:failed', {
        company: company.company_name,
        recipient: company.contact_email,
        error: error.message,
      });

      return { success: false, error: error.message };
    }
  }

  /**
   * Process batch of emails
   */
  async processBatch(batchSize = 100) {
    if (this.queue.length === 0) {
      this._log('info', '[BATCH] Queue is empty');
      return { processed: 0, succeeded: 0, failed: 0 };
    }

    this._log('info', `[BATCH] Processing ${Math.min(batchSize, this.queue.length)} emails`);

    this._prioritizeQueue();

    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    const batch = this.queue.splice(0, batchSize);

    for (const company of batch) {
      const provider = this._selectSMTPProvider();

      if (!provider) {
        this._log('error', '[BATCH] No provider available, stopping batch');
        this.queue.unshift(company); // Return to queue
        break;
      }

      const result = await this._sendSingleEmail(company, provider);

      processed++;
      if (result.success) {
        succeeded++;
      } else {
        failed++;
      }

      // Check SMTP provider health
      if (provider.failures > 10) {
        provider.enabled = false;
        this._log('warn', `[SMTP-HEALTH] Provider disabled: ${provider.name}`);
      }
    }

    this._log('info', `[BATCH] Complete: ${succeeded}/${processed} sent, ${failed} failed`);

    return { processed, succeeded, failed };
  }

  /**
   * Start continuous processing (24/7 mode)
   */
  async startContinuous(interval = 60000) {
    this._log('info', '[ORCHESTRATION] Starting continuous mode...');

    const processLoop = async () => {
      try {
        const result = await this.processBatch(100);
        this.emit('batch:complete', result);

        // Show progress every batch
        this._log('info', `[STATS] Total sent today: ${this.stats.emailsSentToday} | Success: ${this.stats.successCount} | Failed: ${this.stats.failCount}`);
      } catch (error) {
        this._log('error', `[ORCHESTRATION] Error in process loop: ${error.message}`);
      }

      setTimeout(processLoop, interval);
    };

    processLoop();
  }

  /**
   * Get current statistics
   */
  getStats() {
    return {
      ...this.stats,
      queueSize: this.queue.length,
      failedSize: this.failedEmails.length,
      smtpProvidersHealthy: this.smtpPool.filter((p) => p.enabled && p.healthScore > 50)
        .length,
      smtpProvidersTotal: this.smtpPool.length,
      uptime: Date.now() - this.stats.startTime,
    };
  }

  /**
   * Get detailed status
   */
  getStatus() {
    return {
      status: this.processingQueue ? 'processing' : 'idle',
      stats: this.getStats(),
      providers: this.smtpPool.map((p) => ({
        name: p.name,
        enabled: p.enabled,
        healthScore: p.healthScore,
        messagesSent: p.messagesSent,
        failures: p.failures,
      })),
      nextBatchSize: Math.min(100, this.queue.length),
      failedEmails: this.failedEmails.length,
    };
  }

  /**
   * Retry failed emails (exponential backoff)
   */
  async retryFailedEmails() {
    if (this.failedEmails.length === 0) {
      return;
    }

    this._log('info', `[RETRY] Attempting to retry ${this.failedEmails.length} failed emails`);

    const toRetry = [];
    const maxRetries = 3;

    for (const failed of this.failedEmails) {
      const timeSinceFail = Date.now() - failed.timestamp;
      const retryDelay = Math.pow(2, failed.retries) * 3600000; // Exponential: 1h, 2h, 4h

      if (timeSinceFail > retryDelay && failed.retries < maxRetries) {
        toRetry.push(failed);
      } else if (failed.retries >= maxRetries) {
        this._log('warn', `[RETRY] Max retries reached for ${failed.company.company_name}`);
      }
    }

    // Remove from failed list and re-queue
    toRetry.forEach((failed) => {
      this.failedEmails = this.failedEmails.filter((f) => f !== failed);
      this.queue.push(failed.company);
      failed.retries++;
    });

    this._log('info', `[RETRY] Re-queued ${toRetry.length} emails`);
  }

  /**
   * Health check
   */
  async healthCheck() {
    const health = {
      timestamp: new Date().toISOString(),
      status: 'healthy',
      issues: [],
    };

    // Check SMTP providers
    if (this.smtpPool.length === 0) {
      health.issues.push('No SMTP providers configured');
      health.status = 'critical';
    }

    const disabledCount = this.smtpPool.filter((p) => !p.enabled).length;
    if (disabledCount === this.smtpPool.length) {
      health.issues.push('All SMTP providers are disabled');
      health.status = 'critical';
    }

    // Check queue
    if (this.queue.length > 10000) {
      health.issues.push(`Queue is large: ${this.queue.length} items`);
      health.status = 'warning';
    }

    // Check failure rate
    if (this.stats.successCount + this.stats.failCount > 0) {
      const failureRate =
        this.stats.failCount / (this.stats.successCount + this.stats.failCount);
      if (failureRate > 0.2) {
        health.issues.push(`High failure rate: ${(failureRate * 100).toFixed(1)}%`);
        health.status = 'warning';
      }
    }

    return health;
  }
}

export default EmailOrchestrationEngine;
