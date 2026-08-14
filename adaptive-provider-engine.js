/**
 * ⚡ ADAPTIVE PROVIDER ENGINE
 * 
 * Automatically switches between providers when API limits hit:
 * 1. Premium Proxies (ScraperAPI, ScrapingBee, ZenRows)
 * 2. Free Proxies (Bright Data Free, Oxylabs Free, SmartProxy)
 * 3. Direct Stealth Fetch (Fallback)
 * 
 * ZERO DOWNTIME - System never pauses when APIs are exhausted!
 */

import axios from 'axios';
import providerRegistry from './provider-registry.js';
import { logProviderUsage } from './metrics.js';

export class AdaptiveProviderEngine {
  constructor(config = {}, logger = console) {
    this.config = config;
    this._log = (level, msg) => {
      const prefix = `[ADAPTIVE-ENGINE]`;
      if (logger[level]) logger[level](`${prefix} ${msg}`);
      else console.log(`${prefix} ${msg}`);
    };

    // Tier 0: limit-break (self-hosted, unlimited)
    this.limitbreakProvider = {
      name: 'limitbreak',
      type: 'selfhosted',
      enabled: !!config.limitbreak_url,
      url: config.limitbreak_url || 'http://localhost:8080',
      key: config.limitbreak_key || '',
      quota: Infinity,
      quotaResetHours: 999
    };

    // Tier 1: Premium APIs
    this.premiumProviders = [
      {
        name: 'scraperapi',
        type: 'premium',
        enabled: !!config.scraperapi_key,
        key: config.scraperapi_key,
        urlBuilder: (u, k) => `http://api.scraperapi.com?api_key=${k}&url=${encodeURIComponent(u)}`,
        quota: Infinity,
        quotaResetHours: 24
      },
      {
        name: 'scrapingbee',
        type: 'premium',
        enabled: !!config.scrapingbee_key,
        key: config.scrapingbee_key,
        urlBuilder: (u, k) => `https://app.scrapingbee.com/api/v1/?api_key=${k}&url=${encodeURIComponent(u)}`,
        quota: Infinity,
        quotaResetHours: 24
      },
      {
        name: 'zenrows',
        type: 'premium',
        enabled: !!config.zenrows_key,
        key: config.zenrows_key,
        urlBuilder: (u, k) => `https://api.zenrows.com/v1/?apikey=${k}&url=${encodeURIComponent(u)}`,
        quota: Infinity,
        quotaResetHours: 24
      }
    ];

    // Tier 2: Free APIs (unlimited or very high quota)
    this.freeProviders = [
      {
        name: 'brightdata-free',
        type: 'free',
        enabled: !!config.brightdata_free_key,
        key: config.brightdata_free_key,
        quota: 100,
        quotaResetHours: 24,
        used: 0,
        lastReset: Date.now()
      },
      {
        name: 'oxylabs-free',
        type: 'free',
        enabled: !!config.oxylabs_free_key,
        key: config.oxylabs_free_key,
        quota: 100,
        quotaResetHours: 24,
        used: 0,
        lastReset: Date.now()
      },
      {
        name: 'smartproxy-free',
        type: 'free',
        enabled: !!config.smartproxy_zone,
        zone: config.smartproxy_zone,
        quota: 180,
        quotaResetHours: 730 // Monthly
      }
    ];

    // Tier 3: Direct Stealth (always available)
    this.stealthProvider = {
      name: 'direct-stealth',
      type: 'stealth',
      enabled: true,
      retries: 3,
      backoffMs: 3000
    };

    this.currentTier = 'limitbreak'; // Track current tier
    this.lastTierChange = Date.now();
  }

  /**
   * 🚀 Main fetch with automatic tier switching
   */
  async fetch(url, headers = {}) {
    const domain = new URL(url).hostname;

    // ⚡ Tier 0: Self-hosted limit-break gateway (unlimited, free)
    if (this.limitbreakProvider.enabled) {
      const lbResult = await this._tryLimitBreak(url, headers);
      if (lbResult.success) return lbResult;
      this._log('warn', '🔄 limitbreak failed, falling back to premium tier...');
    }

    // Try premium providers first
    const premiumResult = await this._tryTier('premium', url, headers);
    if (premiumResult.success) {
      this.currentTier = 'premium';
      return premiumResult;
    }

    // Switch to free providers
    this._log('warn', '🔄 Premium providers failed. Switching to FREE proxy rotation...');
    const freeResult = await this._tryTier('free', url, headers);
    if (freeResult.success) {
      this.currentTier = 'free';
      this._log('info', '✅ FREE proxy tier activated successfully');
      return freeResult;
    }

    // Final fallback: Direct stealth
    this._log('warn', '🔄 Free providers exhausted. Using STEALTH direct fetch...');
    const stealthResult = await this._tryStealth(url, headers);
    this.currentTier = 'stealth';
    return stealthResult;
  }

  /**
   * Try all providers in a tier
   */

  /**
   * ⚡ limit-break self-hosted gateway fetch
   */
  async _tryLimitBreak(url, headers = {}) {
    try {
      const provider = this.limitbreakProvider;
      const startTime = Date.now();
      
      const response = await axios.post(
        provider.url + '/v1/fetch',
        {
          url,
          use_proxy: true,
          timeout: 20,
          impersonate: null
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': provider.key
          },
          timeout: 25000
        }
      );

      const elapsed = Date.now() - startTime;
      
      if (response.data && response.data.status === 200 && response.data.body) {
        this._log('info', '✅ [limitbreak] SUCCESS - Response: ' + response.data.body.length + ' bytes (' + elapsed + 'ms)');
        providerRegistry.markSuccess('limitbreak');
        return {
          success: true,
          data: response.data.body,
          source: 'limitbreak',
          provider: 'limitbreak',
          proxy: response.data.proxy,
          impersonate: response.data.impersonate,
          cached: response.data.cached,
          ms: elapsed
        };
      } else {
        const errMsg = response.data?.error || 'Empty or invalid response';
        this._log('warn', '⚠️ [limitbreak] Failed: ' + errMsg);
        return { success: false, source: 'limitbreak', data: null, error: errMsg };
      }
    } catch (err) {
      this._log('warn', '⚠️ [limitbreak] Failed: ' + err.message);
      return { success: false, source: 'limitbreak', data: null, error: err.message };
    }
  }

  async _tryTier(tier, url, headers) {
    let providers = tier === 'premium' ? this.premiumProviders : this.freeProviders;

    // Smart ordering: reorder providers by health score
    if (tier === 'premium' || tier === 'free') {
      providers = providers
        .filter(p => p.enabled)
        .map(p => {
          const health = providerRegistry.getProviderHealth ? providerRegistry.getProviderHealth(p.name) : null;
          const successRate = health ? (health.successCount / (health.successCount + health.failureCount + 1)) : 1;
          const avgLatency = health && health.avgLatency ? health.avgLatency : 0;
          const isAvailable = providerRegistry.isAvailable ? providerRegistry.isAvailable(p.name) : true;
          return { 
            provider: p, 
            healthScore: (isAvailable ? 100 : 0) + (successRate * 50) - (avgLatency / 100)
          };
        })
        .sort((a, b) => b.healthScore - a.healthScore)
        .map(x => x.provider);
    }

    for (const provider of providers) {
      if (!provider.enabled) continue;

      // Check provider registry (cooldown check)
      if (!providerRegistry.isAvailable(provider.name)) {
        this._log('debug', `[${provider.name}] on cooldown, skipping...`);
        continue;
      }

      // Check quota for free providers
      if (tier === 'free' && this._isQuotaExhausted(provider)) {
        this._log('debug', `[${provider.name}] quota exhausted, skipping...`);
        continue;
      }

      const t0 = Date.now();
      try {
        const result = await this._fetchWithProvider(provider, url, headers);
        if (result) {
          providerRegistry.markSuccess(provider.name);
          if (tier === 'free') provider.used++;
          this._log('info', `✅ [${provider.name}] SUCCESS - Response: ${result.length || 0} bytes`);
          logProviderUsage({ provider: provider.name, action: 'scrape', status: 'success', durationMs: Date.now() - t0, target: url });
          return { success: true, data: result, source: provider.name };
        }
      } catch (error) {
        this._handleProviderError(provider, error, t0, url);
      }
    }

    return { success: false, data: null, source: tier };
  }

  /**
   * Fetch using a specific provider
   */
  async _fetchWithProvider(provider, url, headers = {}) {
    const timeout = 20000;
    const defaultHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
      ...headers
    };

    let fetchUrl = url;

    // Build provider URL if it's a premium provider with urlBuilder
    if (provider.urlBuilder && provider.key) {
      fetchUrl = provider.urlBuilder(url, provider.key);
    }

    const response = await axios.get(fetchUrl, {
      timeout,
      headers: defaultHeaders,
      validateStatus: (status) => status < 500
    });

    if (!response.data || typeof response.data !== 'string' || response.data.length < 100) {
      throw new Error(`Empty or invalid response from ${provider.name} (type: ${typeof response.data})`);
    }

    return response.data;
  }

  /**
   * Handle provider errors and update registry
   */
  _handleProviderError(provider, error, t0, url) {
    const status = error.response?.status;
    const message = error.message || '';
    const durationMs = t0 ? Date.now() - t0 : null;

    if (status === 402 || status === 429 || message.includes('quota')) {
      this._log('error', `❌ [${provider.name}] QUOTA EXHAUSTED (${status})`);
      providerRegistry.markFailure(provider.name, status, 'rate_limit');
      logProviderUsage({ provider: provider.name, action: 'scrape', status: 'rate_limit', durationMs, target: url, error: message });
    } else if (status === 401 || status === 403) {
      this._log('error', `❌ [${provider.name}] AUTH FAILED (${status})`);
      providerRegistry.markFailure(provider.name, status, 'auth');
      logProviderUsage({ provider: provider.name, action: 'scrape', status: 'auth_error', durationMs, target: url, error: message });
    } else {
      this._log('warn', `⚠️ [${provider.name}] Failed: ${message}`);
      providerRegistry.markFailure(provider.name, status, 'unknown');
      logProviderUsage({ provider: provider.name, action: 'scrape', status: 'failure', durationMs, target: url, error: message });
    }
  }

  /**
   * Check if free provider quota is exhausted
   */
  _isQuotaExhausted(provider) {
    const now = Date.now();
    const hoursSinceReset = (now - provider.lastReset) / (1000 * 60 * 60);

    // Auto-reset if period passed
    if (hoursSinceReset >= provider.quotaResetHours) {
      provider.used = 0;
      provider.lastReset = now;
      this._log('info', `🔄 [${provider.name}] Quota reset`);
    }

    return provider.used >= provider.quota;
  }

  /**
   * Stealth direct fetch with retries
   */
  async _tryStealth(url, headers = {}) {
    const defaultHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      ...headers
    };
    const t0 = Date.now();

    for (let attempt = 0; attempt < this.stealthProvider.retries; attempt++) {
      try {
        const response = await axios.get(url, {
          timeout: 12000,
          headers: defaultHeaders,
          validateStatus: (status) => status < 500
        });

        if (response.data && response.data.length > 100) {
          this._log('info', `✅ [STEALTH-FETCH] SUCCESS on attempt ${attempt + 1} - ${response.data.length} bytes`);
          logProviderUsage({ provider: 'stealth', action: 'scrape', status: 'success', durationMs: Date.now() - t0, target: url });
          return { success: true, data: response.data, source: 'direct-stealth' };
        }

        if (attempt < this.stealthProvider.retries - 1) {
          const delay = this.stealthProvider.backoffMs * Math.pow(2, attempt);
          this._log('info', `🔄 [STEALTH-FETCH] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
        }
      } catch (error) {
        if (attempt < this.stealthProvider.retries - 1) {
          const delay = this.stealthProvider.backoffMs * Math.pow(2, attempt);
          this._log('warn', `⚠️ [STEALTH-FETCH] Attempt ${attempt + 1}: ${error.message}, retrying...`);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    this._log('error', '❌ [STEALTH-FETCH] All retries exhausted');
    logProviderUsage({ provider: 'stealth', action: 'scrape', status: 'failure', durationMs: Date.now() - t0, target: url, error: 'all retries exhausted' });
    return { success: false, data: null, source: 'stealth-failed' };
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      currentTier: this.currentTier,
      premiumHealthy: this.premiumProviders.filter(p => p.enabled && providerRegistry.isAvailable(p.name)).length,
      freeHealthy: this.freeProviders.filter(p => p.enabled && !this._isQuotaExhausted(p)).length,
      stealthAvailable: this.stealthProvider.enabled,
      lastTierChange: new Date(this.lastTierChange).toISOString()
    };
  }
}

export default AdaptiveProviderEngine;
