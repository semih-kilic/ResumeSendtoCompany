/**
 * 🎭 ANTI-DETECTION ENGINE
 * 
 * Prevents email systems and web scrapers from flagging us as automated/spam:
 * - User-Agent rotation (mimic real browsers)
 * - Timing variation (human-like delays)
 * - Request pattern randomization
 * - Behavioral simulation
 * - IP rotation with proxy support
 * - Email header obfuscation
 * 
 * This engine ensures 24/7 operation without getting flagged/blocked
 */

import crypto from 'crypto';
import { EventEmitter } from 'events';

export class AntiDetectionEngine extends EventEmitter {
  constructor(config = {}, logger = console) {
    super();
    this.config = config;
    this._log = logger;

    // User-Agent pool (rotating)
    this.userAgents = this._initializeUserAgents();
    this.userAgentIndex = 0;

    // Proxy pool (rotating)
    this.proxies = this._initializeProxies(config);
    this.proxyIndex = 0;

    // Request pattern tracking
    this.requestPatterns = new Map();
    this.domainRequestCounts = new Map();
    this.lastRequestTime = new Map();

    // Behavioral metrics
    this.stats = {
      requestsMade: 0,
      proxyRotations: 0,
      userAgentRotations: 0,
      timedRequests: 0,
      blockedDetections: 0,
    };

    this._log('info', '[ANTI-DETECTION] Engine initialized');
  }

  /**
   * Initialize list of realistic User-Agents
   */
  _initializeUserAgents() {
    return [
      // Chrome
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',

      // Firefox
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
      'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',

      // Safari
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1.1 Safari/605.1.15',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',

      // Edge
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',

      // Mobile
      'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
    ];
  }

  /**
   * Initialize proxy pool
   */
  _initializeProxies(config) {
    const proxies = [];

    // Add configured proxies
    if (config.proxy_list && Array.isArray(config.proxy_list)) {
      proxies.push(...config.proxy_list);
    }

    // Add free tier proxy if configured
    if (config.use_free_proxies) {
      proxies.push(...[
        'http://proxy1.freeproxy.com:8080',
        'http://proxy2.freeproxy.com:8080',
        'http://proxy3.freeproxy.com:8080',
      ]);
    }

    this._log(
      'info',
      `[ANTI-DETECTION] Initialized with ${proxies.length} proxies`
    );
    return proxies;
  }

  /**
   * Get next User-Agent (with variation)
   */
  getRotatedUserAgent() {
    const ua = this.userAgents[this.userAgentIndex % this.userAgents.length];
    this.userAgentIndex++;
    this.stats.userAgentRotations++;

    return ua;
  }

  /**
   * Get next proxy (with fallback)
   */
  getRotatedProxy() {
    if (this.proxies.length === 0) {
      return null;
    }

    const proxy = this.proxies[this.proxyIndex % this.proxies.length];
    this.proxyIndex++;
    this.stats.proxyRotations++;

    return proxy;
  }

  /**
   * Get randomized request headers (mimics real browser)
   */
  getHeaders(domain = 'generic') {
    return {
      'User-Agent': this.getRotatedUserAgent(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': this._randomizeLanguage(),
      'Accept-Encoding': 'gzip, deflate',
      'DNT': Math.random() > 0.5 ? '1' : '0',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Cache-Control': 'max-age=0',
      'Referer': this._generateFakeReferer(domain),
    };
  }

  /**
   * Randomize Accept-Language header
   */
  _randomizeLanguage() {
    const languages = [
      'en-US,en;q=0.9',
      'en-CA,en;q=0.9',
      'en-GB,en;q=0.8,en-US;q=0.7',
      'en;q=0.9,en-US;q=0.8',
      'en-US,en;q=0.9,fr;q=0.8',
    ];

    return languages[Math.floor(Math.random() * languages.length)];
  }

  /**
   * Generate fake referer to look like real user
   */
  _generateFakeReferer(domain) {
    const referrers = [
      'https://www.google.com/search?q=',
      'https://www.linkedin.com/',
      'https://www.indeed.com/',
      'https://www.glassdoor.com/',
      'https://www.google.com/',
    ];

    return referrers[Math.floor(Math.random() * referrers.length)] + domain;
  }

  /**
   * Calculate human-like delay between requests
   * - Short delays for rapid activity (2-5 sec)
   * - Medium delays for normal browsing (10-30 sec)
   * - Long delays to avoid patterns (30-120 sec)
   */
  calculateDelay(domain, intensity = 'normal') {
    // Track per-domain request patterns
    const count = this.domainRequestCounts.get(domain) || 0;
    this.domainRequestCounts.set(domain, count + 1);

    let baseDelay = 0;

    switch (intensity) {
      case 'fast':
        baseDelay = 2000 + Math.random() * 3000; // 2-5 sec
        break;
      case 'normal':
        baseDelay = 10000 + Math.random() * 20000; // 10-30 sec
        break;
      case 'slow':
        baseDelay = 30000 + Math.random() * 90000; // 30-120 sec
        break;
      default:
        baseDelay = 5000 + Math.random() * 10000; // 5-15 sec
    }

    // Add jitter to prevent predictable patterns
    const jitter = (Math.random() - 0.5) * 2000; // ±1 sec
    const finalDelay = baseDelay + jitter;

    this.stats.timedRequests++;

    return Math.max(1000, finalDelay); // Minimum 1 sec
  }

  /**
   * Wait with realistic delay
   */
  async waitWithDelay(domain, intensity = 'normal') {
    const delay = this.calculateDelay(domain, intensity);
    this._log(
      'debug',
      `[ANTI-DETECTION] Waiting ${(delay / 1000).toFixed(1)}s before next request to ${domain}`
    );
    await new Promise((r) => setTimeout(r, delay));
  }

  /**
   * Get request headers for email (obfuscate automated nature)
   */
  getEmailHeaders() {
    return {
      'X-Priority': Math.random() > 0.5 ? '1' : '3',
      'X-MSMail-Priority': Math.random() > 0.5 ? 'High' : 'Normal',
      'Importance': Math.random() > 0.5 ? 'high' : 'normal',
      'X-Mailer': this._randomizeMailer(),
      'MIME-Version': '1.0',
    };
  }

  /**
   * Randomize X-Mailer header (hide that we use nodemailer)
   */
  _randomizeMailer() {
    const mailers = [
      'Apple Mail (2.2.1084)',
      'Mozilla Thunderbird 115.6.0',
      'Gmail',
      'Microsoft Outlook 16.0',
      'Postfix',
      'Exim',
    ];

    return mailers[Math.floor(Math.random() * mailers.length)];
  }

  /**
   * Simulate real user behavior pattern (browsing, reading, then replying)
   */
  async simulateBrowsingBehavior(domain) {
    const behaviors = [
      {
        name: 'quick_scan',
        delays: [2000, 3000, 1000], // skim page quickly
      },
      {
        name: 'careful_read',
        delays: [15000, 8000, 5000], // read thoroughly
      },
      {
        name: 'research',
        delays: [12000, 8000, 20000, 5000], // multiple sections
      },
    ];

    const behavior =
      behaviors[Math.floor(Math.random() * behaviors.length)];

    this._log(
      'debug',
      `[ANTI-DETECTION] Simulating ${behavior.name} on ${domain}`
    );

    for (const delay of behavior.delays) {
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  /**
   * Detect if request was blocked/flagged
   */
  detectBlockage(response) {
    if (!response) {
      return { blocked: false };
    }

    const headers = response.headers || {};
    const body = response.body || '';
    const status = response.status || 0;

    const blockIndicators = {
      captcha: [
        'captcha',
        'recaptcha',
        'hcaptcha',
        'cf_clearance',
        'challenge',
      ],
      blocked: [
        'blocked',
        'suspended',
        'access denied',
        'forbidden',
        'unauthorized',
      ],
      rateLimit: [
        'rate limit',
        'too many requests',
        '429',
        'throttle',
        'temporarily unavailable',
      ],
      botDetection: [
        'bot',
        'automated',
        'automated access',
        'user agent',
        'suspicious',
      ],
    };

    let blockType = null;
    let reason = null;

    // Check status codes
    if ([403, 429, 503].includes(status)) {
      blockType = 'rate_limit';
      reason = `HTTP ${status}`;
      this.stats.blockedDetections++;
    }

    // Check response body
    const bodyLower = body.toLowerCase();
    for (const [type, indicators] of Object.entries(blockIndicators)) {
      for (const indicator of indicators) {
        if (
          bodyLower.includes(indicator) ||
          headers['x-blocked']?.toString().includes(indicator)
        ) {
          blockType = type;
          reason = indicator;
          this.stats.blockedDetections++;
          break;
        }
      }
      if (blockType) break;
    }

    return {
      blocked: !!blockType,
      blockType,
      reason,
      statusCode: status,
      suggestedAction: this._suggestBlockageRecovery(blockType),
    };
  }

  /**
   * Suggest recovery action for detected blockage
   */
  _suggestBlockageRecovery(blockType) {
    const recovery = {
      captcha: [
        'Add CAPTCHA solving service (2captcha, Anti-Captcha)',
        'Reduce request rate',
        'Increase delay between requests',
      ],
      blocked: [
        'Switch proxy',
        'Rotate User-Agent',
        'Wait before retry (exponential backoff)',
        'Check API quotas',
      ],
      rate_limit: [
        'Increase delay between requests',
        'Reduce batch size',
        'Switch to different IP/proxy',
        'Implement request queue',
      ],
      botDetection: [
        'Add random delays between actions',
        'Vary User-Agent more frequently',
        'Enable behavioral simulation',
        'Use residential proxies',
      ],
    };

    return recovery[blockType] || ['Reduce activity', 'Wait and retry'];
  }

  /**
   * Generate request fingerprint (for detection)
   */
  getFingerprint() {
    return {
      timestamp: Date.now(),
      userAgent: this.userAgents[this.userAgentIndex],
      proxyUsed: this.proxies.length > 0,
      requestCount: this.stats.requestsMade,
      rotationPattern: `ua:${this.stats.userAgentRotations},proxy:${this.stats.proxyRotations}`,
    };
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      userAgentsCount: this.userAgents.length,
      proxiesCount: this.proxies.length,
      trackedDomains: this.domainRequestCounts.size,
      averageDelay:
        this.stats.timedRequests > 0
          ? `${(this.stats.timedRequests / 100).toFixed(0)}-${(this.stats.timedRequests / 50).toFixed(0)}s`
          : 'N/A',
    };
  }

  /**
   * Health check
   */
  healthCheck() {
    const health = {
      timestamp: new Date().toISOString(),
      status: 'healthy',
      issues: [],
    };

    if (this.userAgents.length < 5) {
      health.issues.push('Too few User-Agents configured');
      health.status = 'warning';
    }

    if (this.proxies.length === 0) {
      health.issues.push('No proxies available (using direct IP)');
    }

    if (this.stats.blockedDetections > 100) {
      health.issues.push('High blockage detection rate');
      health.status = 'warning';
    }

    return health;
  }

  /**
   * Reset daily statistics
   */
  resetDailyStats() {
    this.domainRequestCounts.clear();
    this.lastRequestTime.clear();
    this._log('info', '[ANTI-DETECTION] Daily stats reset');
  }
}

export default AntiDetectionEngine;
