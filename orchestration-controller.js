/**
 * 🎯 ORCHESTRATION CONTROLLER
 * 
 * Master controller that coordinates all engines:
 * - EmailOrchestrationEngine (batch sending)
 * - AntiDetectionEngine (safety/stealth)
 * - AdaptiveProviderEngine (resilience)
 * - Discovery engine (finding companies)
 * 
 * This is the CONDUCTOR that makes everything work together
 */

import EventEmitter from 'events';
import EmailOrchestrationEngine from './email-orchestration-engine.js';
import AntiDetectionEngine from './anti-detection-engine.js';
import AdaptiveProviderEngine from './adaptive-provider-engine.js';

export class OrchestrationController extends EventEmitter {
  constructor(config = {}, db = null, logger = console) {
    super();
    this.config = config;
    this.db = db;
    this._log = logger;

    // Initialize engines
    this.emailEngine = new EmailOrchestrationEngine(config, db, logger);
    this.antiDetectionEngine = new AntiDetectionEngine(config, logger);
    this.providerEngine = new AdaptiveProviderEngine(config, logger);

    // State
    this.isRunning = false;
    this.isPaused = false;
    this.currentCampaignId = null;

    // Statistics
    this.stats = {
      startTime: Date.now(),
      totalEmailsSent: 0,
      totalEmailsSuccess: 0,
      totalEmailsFailed: 0,
      totalCompaniesProcessed: 0,
    };

    this._setupEventListeners();
    this._log('info', '[ORCHESTRATION-CONTROLLER] Initialized');
  }

  /**
   * Setup event listeners for all engines
   */
  _setupEventListeners() {
    // Email engine events
    this.emailEngine.on('email:sent', (data) => {
      this.stats.totalEmailsSent++;
      this.stats.totalEmailsSuccess++;
      this.emit('email:sent', data);
    });

    this.emailEngine.on('email:failed', (data) => {
      this.stats.totalEmailsFailed++;
      this.emit('email:failed', data);
    });

    this.emailEngine.on('batch:complete', (data) => {
      this.emit('batch:complete', data);
    });

    // Anti-detection events
    this.antiDetectionEngine.on('detection:blocked', (data) => {
      this._log('warn', `[DETECTION] Blockage detected: ${data.reason}`);
      this.emit('detection:blocked', data);
      
      // Auto-recovery
      this._handleDetectionBlockage(data);
    });
  }

  /**
   * Start the full outreach campaign
   */
  async startCampaign(campaignConfig = {}) {
    if (this.isRunning) {
      this._log('warn', '[CAMPAIGN] Already running');
      return false;
    }

    this.isRunning = true;

    this._log('info', '[CAMPAIGN] Starting outreach campaign...');
    console.log('🚀 Campaign Started:');
    console.log(`  📧 Target Volume: ${campaignConfig.daily_volume || 500}/day`);
    console.log(`  🎯 Duration: 24/7 continuous`);
    console.log(`  🔄 Mode: ${campaignConfig.mode || 'adaptive'}`);
    console.log('');

    // Create campaign record
    if (this.db) {
      const result = await this.db.run(
        `INSERT INTO campaigns (name, status, target_daily_volume) 
         VALUES (?, 'running', ?)`,
        [campaignConfig.name || 'Campaign-' + Date.now(), campaignConfig.daily_volume || 500]
      );
      this.currentCampaignId = result.lastID;
    }

    // Start continuous processing
    await this.emailEngine.startContinuous(campaignConfig.batch_interval || 60000);

    // Start monitoring
    this._startHealthMonitoring();

    // Start anti-detection behavioral simulation
    this._startBehavioralSimulation();

    this.emit('campaign:started', { campaignId: this.currentCampaignId });

    return true;
  }

  /**
   * Pause campaign (graceful - don't stop mid-batch)
   */
  async pauseCampaign() {
    if (!this.isRunning) {
      return false;
    }

    this.isPaused = true;
    this._log('info', '[CAMPAIGN] Pausing campaign');

    return true;
  }

  /**
   * Resume campaign
   */
  async resumeCampaign() {
    if (!this.isRunning) {
      return false;
    }

    this.isPaused = false;
    this._log('info', '[CAMPAIGN] Resuming campaign');

    return true;
  }

  /**
   * Stop campaign (graceful shutdown)
   */
  async stopCampaign() {
    this.isRunning = false;
    this.isPaused = false;

    this._log('info', '[CAMPAIGN] Stopping campaign');

    // Wait for in-flight requests to complete
    await new Promise((r) => setTimeout(r, 5000));

    // Save final stats
    if (this.db && this.currentCampaignId) {
      const stats = this.getStats();
      await this.db.run(
        `UPDATE campaigns 
         SET status = 'completed', 
             emails_sent = ?, 
             ended_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [stats.totalEmailsSent, this.currentCampaignId]
      );
    }

    this.emit('campaign:stopped', { stats: this.getStats() });

    return true;
  }

  /**
   * Add companies to queue
   */
  async enqueueCompanies(companies) {
    if (!Array.isArray(companies)) {
      this._log('error', '[ENQUEUE] Invalid input');
      return false;
    }

    this._log('info', `[ENQUEUE] Adding ${companies.length} companies to queue`);

    // Enhance company data with anti-detection metadata
    const enhancedCompanies = companies.map((company) => ({
      ...company,
      user_agent: this.antiDetectionEngine.getRotatedUserAgent(),
      proxy: this.antiDetectionEngine.getRotatedProxy(),
      timing_profile: this._selectTimingProfile(),
    }));

    return await this.emailEngine.enqueueCompanies(enhancedCompanies);
  }

  /**
   * Select timing profile for company (human-like behavior)
   */
  _selectTimingProfile() {
    const profiles = [
      'early_bird', // 6-9 AM
      'morning_worker', // 9-12 PM
      'lunch_break', // 12-1 PM
      'afternoon', // 1-5 PM
      'evening', // 5-8 PM
    ];

    return profiles[Math.floor(Math.random() * profiles.length)];
  }

  /**
   * Handle detection blockage (auto-recovery)
   */
  async _handleDetectionBlockage(blockageData) {
    this._log('warn', '[RECOVERY] Handling blockage: ' + blockageData.reason);

    const actions = blockageData.suggestedAction || [];

    for (const action of actions) {
      if (action.includes('proxy')) {
        this._log('info', '[RECOVERY] Rotating proxy');
        // Provider engine will handle this automatically
      } else if (action.includes('User-Agent')) {
        this._log('info', '[RECOVERY] Rotating User-Agent');
        // Anti-detection engine will handle this automatically
      } else if (action.includes('delay')) {
        this._log('info', '[RECOVERY] Increasing delay');
        this.emailEngine.minDelayMs *= 1.5; // Increase delay by 50%
      } else if (action.includes('pause')) {
        this._log('info', '[RECOVERY] Pausing temporarily');
        await this.pauseCampaign();
        await new Promise((r) => setTimeout(r, 300000)); // Wait 5 minutes
        await this.resumeCampaign();
      }
    }

    this.emit('recovery:action', { action: actions[0], timestamp: Date.now() });
  }

  /**
   * Start health monitoring (5-minute intervals)
   */
  _startHealthMonitoring() {
    const monitoringInterval = setInterval(async () => {
      if (!this.isRunning) {
        clearInterval(monitoringInterval);
        return;
      }

      const emailHealth = await this.emailEngine.healthCheck();
      const antiDetHealth = this.antiDetectionEngine.healthCheck();
      const providerHealth = this.providerEngine.getStatus();

      // Log combined health
      this._log('info', '[HEALTH-CHECK] Status: ' + emailHealth.status);

      if (emailHealth.issues.length > 0) {
        this._log('warn', '[HEALTH-CHECK] Issues: ' + emailHealth.issues.join('; '));
      }

      this.emit('health:check', {
        emailEngine: emailHealth,
        antiDetection: antiDetHealth,
        provider: providerHealth,
        timestamp: new Date(),
      });

      // Alert on critical issues
      if (emailHealth.status === 'critical') {
        this.emit('alert:critical', {
          component: 'emailEngine',
          issues: emailHealth.issues,
        });
      }
    }, 300000); // Every 5 minutes
  }

  /**
   * Start behavioral simulation
   */
  async _startBehavioralSimulation() {
    const simulationInterval = setInterval(async () => {
      if (!this.isRunning || this.isPaused) {
        return;
      }

      // Randomly simulate browsing behavior (avoid predictable patterns)
      if (Math.random() > 0.8) {
        const domain = 'linkedin.com'; // Common target domain
        await this.antiDetectionEngine.simulateBrowsingBehavior(domain);
      }
    }, 3600000); // Every hour
  }

  /**
   * Get comprehensive statistics
   */
  getStats() {
    const emailStats = this.emailEngine.getStats();
    const antiDetStats = this.antiDetectionEngine.getStats();

    const uptime = Date.now() - this.stats.startTime;
    const uptimeHours = uptime / 3600000;

    return {
      campaign: {
        isRunning: this.isRunning,
        isPaused: this.isPaused,
        id: this.currentCampaignId,
      },
      emails: {
        sent: emailStats.emailsSentToday,
        succeeded: emailStats.successCount,
        failed: emailStats.failCount,
        successRate: emailStats.successCount + emailStats.failCount > 0
          ? ((emailStats.successCount / (emailStats.successCount + emailStats.failCount)) * 100).toFixed(1) + '%'
          : 'N/A',
        queueSize: emailStats.queueSize,
        failedRetry: emailStats.failedSize,
      },
      providers: {
        smtpHealthy: emailStats.smtpProvidersHealthy,
        smtpTotal: emailStats.smtpProvidersTotal,
        rotations: {
          userAgent: antiDetStats.userAgentRotations,
          proxy: antiDetStats.proxyRotations,
        },
      },
      performance: {
        uptime: uptimeHours.toFixed(1) + ' hours',
        emailsPerHour: (emailStats.emailsSentToday / Math.max(1, uptimeHours)).toFixed(0),
        avgDelay: emailStats.avgDelay,
        blockDetections: antiDetStats.blockedDetections,
      },
      antiDetection: antiDetStats,
    };
  }

  /**
   * Get detailed status JSON
   */
  getStatus() {
    return {
      timestamp: new Date().toISOString(),
      controller: {
        isRunning: this.isRunning,
        isPaused: this.isPaused,
        uptime: Date.now() - this.stats.startTime,
      },
      emailEngine: this.emailEngine.getStatus(),
      antiDetectionEngine: this.antiDetectionEngine.getStats(),
      providerEngine: this.providerEngine.getStatus(),
      stats: this.getStats(),
    };
  }

  /**
   * Export statistics to database
   */
  async exportStats() {
    if (!this.db) {
      return false;
    }

    const today = new Date().toISOString().split('T')[0];
    const stats = this.getStats();

    try {
      await this.db.run(
        `INSERT OR REPLACE INTO daily_statistics 
         (date, emails_sent, emails_delivered, system_uptime_pct) 
         VALUES (?, ?, ?, ?)`,
        [
          today,
          stats.emails.sent,
          stats.emails.succeeded,
          Math.min(100, (stats.performance.uptime * 100) / 24),
        ]
      );

      return true;
    } catch (error) {
      this._log('error', '[EXPORT-STATS] Error: ' + error.message);
      return false;
    }
  }

  /**
   * Log event to database
   */
  async logEvent(eventType, eventData) {
    if (!this.db) {
      return false;
    }

    try {
      await this.db.run(
        `INSERT INTO alerts (alert_type, severity, title, description) 
         VALUES (?, ?, ?, ?)`,
        [
          eventType,
          eventData.severity || 'info',
          eventData.title || 'Event',
          eventData.description || JSON.stringify(eventData),
        ]
      );

      return true;
    } catch (error) {
      this._log('error', '[LOG-EVENT] Error: ' + error.message);
      return false;
    }
  }
}

export default OrchestrationController;
