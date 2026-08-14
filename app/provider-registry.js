import { EventEmitter } from 'events';

class ProviderRegistry extends EventEmitter {
  constructor(config = {}) {
    super();
    // Map: provider -> { enabled, failureCount, lastFailedAt, cooldownUntil, reason }
    this.providers = new Map();
    this._logUsage = null;
    this._smartSelector = null;
    this._groupManager = null;

    // Load cooldown config (in seconds) — convert to milliseconds
    this.cooldowns = {
      auth: (config.provider_cooldowns?.auth || 24 * 60 * 60) * 1000,
      billing: (config.provider_cooldowns?.billing || 24 * 60 * 60) * 1000,
      rate_limit: (config.provider_cooldowns?.rate_limit || 15 * 60) * 1000,
      unknown: (config.provider_cooldowns?.unknown || 2 * 60) * 1000,
    };
  }

  _ensure(provider) {
    if (!this.providers.has(provider)) {
      this.providers.set(provider, { enabled: true, failureCount: 0, lastFailedAt: null, cooldownUntil: null, reason: null });
    }
    return this.providers.get(provider);
  }

  markFailure(provider, status = null, reason = 'error') {
    const p = this._ensure(provider);
    p.failureCount = (p.failureCount || 0) + 1;
    p.lastFailedAt = Date.now();
    p.reason = reason;

    // Determine cooldown based on reason/status
    let cooldownMs = this.cooldowns.unknown;
    if (reason === 'auth') cooldownMs = this.cooldowns.auth;
    if (reason === 'billing') cooldownMs = this.cooldowns.billing;
    if (reason === 'rate_limit') cooldownMs = this.cooldowns.rate_limit;
    if (status === 429) cooldownMs = Math.max(cooldownMs, this.cooldowns.rate_limit);

    p.cooldownUntil = Date.now() + cooldownMs;
    p.enabled = false;

    console.warn(`[PROVIDER-REGISTRY] ${provider} marked failed (reason=${reason}, status=${status}). Disabled until ${new Date(p.cooldownUntil).toISOString()}`);

    if (this._logUsage) this._logUsage(provider, 'generic', 'failure', null, null, reason);

    // Notify group manager to rotate to fallback
    if (this._groupManager) {
      // Find which group this provider belongs to
      for (const [groupName, group] of Object.entries(this._groupManager.getAllGroups())) {
        const all = [group.primary, ...(group.fallbacks || [])];
        if (all.includes(provider)) {
          this._groupManager.markGroupFailure(groupName);
          break;
        }
      }
    }

    this.emit('provider:failed', { provider, reason, status, cooldownUntil: p.cooldownUntil, failureCount: p.failureCount });
  }

  markSuccess(provider) {
    const p = this._ensure(provider);
    p.failureCount = 0;
    p.lastFailedAt = null;
    p.cooldownUntil = null;
    p.reason = null;
    p.enabled = true;
    console.info(`[PROVIDER-REGISTRY] ${provider} marked healthy`);

    if (this._logUsage) this._logUsage(provider, 'generic', 'success', null, null, null);

    this.emit('provider:recovered', { provider });
  }

  isAvailable(provider) {
    const p = this._ensure(provider);
    if (!p.enabled) {
      if (p.cooldownUntil && Date.now() >= p.cooldownUntil) {
        p.failureCount = 0;
        p.lastFailedAt = null;
        p.cooldownUntil = null;
        p.reason = null;
        p.enabled = true;
        console.info(`[PROVIDER-REGISTRY] ${provider} auto-recovered after cooldown`);
      }
      return p.enabled;
    }
    return true;
  }

  getStatus(provider) {
    const p = this._ensure(provider);
    return { ...p };
  }

  /**
   * Initialize provider registry with config
   * Called from server.js or other entry points
   */
  setLogUsage(fn) {
    this._logUsage = fn;
  }

  initializeWithConfig(config) {
    this.cooldowns = {
      auth: (config.provider_cooldowns?.auth || 24 * 60 * 60) * 1000,
      billing: (config.provider_cooldowns?.billing || 24 * 60 * 60) * 1000,
      rate_limit: (config.provider_cooldowns?.rate_limit || 15 * 60) * 1000,
      unknown: (config.provider_cooldowns?.unknown || 2 * 60) * 1000,
    };
    console.info('[PROVIDER-REGISTRY] Initialized with config:', {
      auth: `${this.cooldowns.auth / 1000}s`,
      billing: `${this.cooldowns.billing / 1000}s`,
      rate_limit: `${this.cooldowns.rate_limit / 1000}s`,
      unknown: `${this.cooldowns.unknown / 1000}s`,
    });
  }

  setSmartSelector(selector) {
    this._smartSelector = selector;
  }

  getRankedProviders(action, providerList) {
    if (!this._smartSelector) return providerList;
    return this._smartSelector.getRankedProviders(action, providerList);
  }

  setGroupManager(gm) {
    this._groupManager = gm;
  }

  getGroupProviders(groupName) {
    if (!this._groupManager) return [];
    const group = this._groupManager.getGroup(groupName);
    if (!group) return [];
    return [group.primary, ...(group.fallbacks || [])];
  }

  getAvailableGroupProvider(groupName) {
    if (!this._groupManager) return null;
    return this._groupManager.getAvailableProvider(groupName);
  }

  getGroupStatus(groupName) {
    if (!this._groupManager) return null;
    return this._groupManager.getGroupStatus(groupName);
  }

  getAllGroupStatuses() {
    if (!this._groupManager) return {};
    const groups = this._groupManager.getAllGroups();
    const out = {};
    for (const name of Object.keys(groups)) {
      out[name] = this._groupManager.getGroupStatus(name);
    }
    return out;
  }
}

const registry = new ProviderRegistry();
export default registry;
