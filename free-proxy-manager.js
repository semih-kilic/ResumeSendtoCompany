/**
 * ✨ FREE PROXY MANAGER
 * 
 * Manages free tier proxy accounts automatically
 * When one quota is exhausted, rotates to next available
 * 
 * Supported free proxies:
 * - Bright Data free tier (100 requests/month free)
 * - Oxylabs free tier (100 requests/month free)
 * - Bright Data Smart Proxy (180 seconds free)
 * - Raw.githubusercontent.com proxy list (public)
 */

import axios from 'axios';
import providerRegistry from './provider-registry.js';

export class FreeProxyManager {
  constructor(config = {}, logger = console) {
    this.config = config;
    this._log = (level, msg) => {
      if (logger[level]) logger[level](`[PROXY-MGR] ${msg}`);
      else console.log(`[PROXY-MGR] ${msg}`);
    };

    // ✨ Free proxy tiers with rotation
    this.proxyTiers = [
      {
        name: 'brightdata-free',
        type: 'http',
        enabled: true,
        key: config.brightdata_free_key,
        quotaPerDay: 100,
        used: 0,
        lastReset: Date.now(),
      },
      {
        name: 'oxylabs-free',
        type: 'http',
        enabled: true,
        key: config.oxylabs_free_key,
        quotaPerDay: 100,
        used: 0,
        lastReset: Date.now(),
      },
      {
        name: 'smart-proxy-tunnel',
        type: 'http',
        enabled: !!config.smartproxy_zone,
        zone: config.smartproxy_zone || 'rotating',
        quotaPerMonth: 180, // Free trial
        used: 0,
      }
    ];

    this.currentTierIndex = 0;
    this.publicProxies = [];
  }

  /**
   * Get next working proxy
   * @returns { proxy, tier, score } or null if all exhausted
   */
  async getNextProxy() {
    // ✨ Reset daily quotas if needed
    this._resetDailyQuotas();

    // Try each tier in round-robin
    for (let i = 0; i < this.proxyTiers.length; i++) {
      const tierIndex = (this.currentTierIndex + i) % this.proxyTiers.length;
      const tier = this.proxyTiers[tierIndex];

      if (!tier.enabled) continue;
      if (!this._isQuotaAvailable(tier)) continue;

      // Skip if provider-registry marked this provider as unavailable
      if (providerRegistry && !providerRegistry.isAvailable(tier.name)) {
        this._log('warn', `[${tier.name}] Skipped due to provider-registry disabled`);
        continue;
      }

      this.currentTierIndex = (tierIndex + 1) % this.proxyTiers.length;
      tier.used++;

      this._log('debug', `[${tier.name}] Returning proxy (${tier.used}/${tier.quotaPerDay})`);
      try { providerRegistry.markSuccess(tier.name); } catch (e) {}
      return { proxy: this._buildProxyUrl(tier), tier, score: this._calculateScore(tier) };
    }

    // Fallback: Try public free proxies
    return this._getPublicFreeProxy();
  }

  /**
   * Mark a proxy as failed
   */
  markProxyFailed(tierName, error) {
    const tier = this.proxyTiers.find(t => t.name === tierName);
    if (!tier) return;

    // Check if error is quota/billing
    if (error?.includes('402') || error?.includes('429') || error?.includes('quota')) {
      tier.quotaPerDay = Math.max(0, tier.quotaPerDay - 50);
      this._log('warn', `[${tierName}] Quota reduced to ${tier.quotaPerDay} due to: ${error}`);
      try { providerRegistry.markFailure(tierName, 429, 'rate_limit'); } catch (e) {}
      
      if (tier.quotaPerDay <= 0) {
        this._log('error', `[${tierName}] Quota exhausted, disabling tier`);
        tier.enabled = false;
        try { providerRegistry.markFailure(tierName, 402, 'billing'); } catch (e) {}
      }
    } else {
      // Unknown error - mark transient failure
      try { providerRegistry.markFailure(tierName, null, 'unknown'); } catch (e) {}
    }
  }

  /**
   * Reset daily quotas (called once per day)
   * @private
   */
  _resetDailyQuotas() {
    const now = Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1000;

    for (const tier of this.proxyTiers) {
      if (now - tier.lastReset > ONE_DAY && tier.quotaPerDay) {
        tier.used = 0;
        tier.lastReset = now;
        if (tier.enabled) {
          this._log('info', `[${tier.name}] Daily quota reset to ${tier.quotaPerDay}`);
        }
      }
    }
  }

  /**
   * Check if tier has quota available
   * @private
   */
  _isQuotaAvailable(tier) {
    if (tier.quotaPerDay) {
      return tier.used < tier.quotaPerDay;
    }
    if (tier.quotaPerMonth) {
      return tier.used < tier.quotaPerMonth;
    }
    return true; // No quota tracking
  }

  /**
   * Build proxy URL from tier config
   * @private
   */
  _buildProxyUrl(tier) {
    switch (tier.name) {
      case 'brightdata-free':
        return `http://${tier.key}:@proxy.provider.com:port`;
      case 'oxylabs-free':
        return `http://${tier.key}:@api.oxylabs.io:60000`;
      case 'smart-proxy-tunnel':
        return `http://${tier.zone}:@gate.smartproxy.com:7000`;
      default:
        return null;
    }
  }

  /**
   * Calculate quality score (for choosing best proxy)
   * @private
   */
  _calculateScore(tier) {
    let score = 1.0;

    // Reduce score if approaching quota
    const _remaining = tier.quotaPerDay 
      ? tier.quotaPerDay - tier.used 
      : tier.quotaPerMonth - tier.used;
    const percentUsed = (tier.used / (tier.quotaPerDay || tier.quotaPerMonth)) * 100;
    if (percentUsed > 80) score -= 0.3;
    if (percentUsed > 95) score -= 0.5;

    return Math.max(0, score);
  }

  /**
   * Get public free proxy (fallback)
   * @private
   */
  async _getPublicFreeProxy() {
    try {
      if (this.publicProxies.length === 0) {
        await this._loadPublicProxies();
      }

      if (this.publicProxies.length > 0) {
        const proxy = this.publicProxies[Math.floor(Math.random() * this.publicProxies.length)];
        this._log('info', `[PUBLIC] Using free public proxy: ${proxy}`);
        return { proxy, tier: { name: 'public' }, score: 0.3 };
      }
    } catch (err) {
      this._log('warn', `[PUBLIC] Failed to get public proxy: ${err.message}`);
    }

    return null; // No proxies available
  }

  /**
   * Load public free proxy list
   * @private
   */
  async _loadPublicProxies() {
    try {
      // Free proxy list from public GitHub source
      const response = await axios.get(
        'https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-with-country.txt',
        { timeout: 5000 }
      );

      const lines = response.data.split('\n');
      this.publicProxies = lines
        .filter(line => line && !line.startsWith('#'))
        .map(line => line.split('\t')[0]) // IP:PORT format
        .slice(0, 50); // Keep first 50

      this._log('info', `[PUBLIC] Loaded ${this.publicProxies.length} free public proxies`);
    } catch (err) {
      this._log('warn', `[PUBLIC] Failed to load public proxies: ${err.message}`);
    }
  }

  /**
   * Get current status for monitoring
   */
  getStatus() {
    return {
      tiers: this.proxyTiers.map(t => ({
        name: t.name,
        enabled: t.enabled,
        used: t.used,
        quota: t.quotaPerDay || t.quotaPerMonth,
        percentUsed: Math.round(((t.used) / (t.quotaPerDay || t.quotaPerMonth)) * 100)
      })),
      publicProxiesLoaded: this.publicProxies.length
    };
  }
}

/**
 * Usage in scraper.js:
 * 
 * import { FreeProxyManager } from './free-proxy-manager.js';
 * 
 * const proxyManager = new FreeProxyManager(config, logger);
 * 
 * // In fetchWithFallback():
 * const proxyUrl = await proxyManager.getNextProxy();
 * if (proxyUrl) {
 *   try {
 *     const res = await axios.get(targetUrl, { 
 *       httpAgent: new HttpAgent({ proxy: proxyUrl.proxy }),
 *       httpsAgent: new HttpsAgent({ proxy: proxyUrl.proxy }),
 *       timeout: 20000 
 *     });
 *     return res;
 *   } catch (err) {
 *     proxyManager.markProxyFailed(proxyUrl.tier.name, err.message);
 *     // Try next proxy
 *   }
 * }
 */
