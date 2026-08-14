import providerRegistry from './provider-registry.js';

const DEFAULT_GROUPS = {
  web_scraping: {
    primary: 'scraperapi',
    fallbacks: ['scrapingbee', 'zenrows', 'stealth'],
    retry_on_failure: true,
    description: 'Website scraping proxies',
  },
  email_sending: {
    primary: 'resend',
    fallbacks: ['smtp'],
    retry_on_failure: true,
    description: 'Email delivery providers',
  },
  email_verification: {
    primary: 'reoon',
    fallbacks: ['mailboxvalidator', 'abstractapi'],
    retry_on_failure: false,
    description: 'Email address verification APIs',
  },
  ai_services: {
    primary: 'gemini',
    fallbacks: ['openai'],
    retry_on_failure: true,
    description: 'AI content generation APIs',
  },
};

export class GroupManager {
  constructor(groups = {}) {
    this.groups = this._normalize(groups);
    this._activeProvider = {};
    for (const name of Object.keys(this.groups)) {
      this._activeProvider[name] = this.groups[name].primary;
    }
  }

  _normalize(groups) {
    const merged = {};
    const allKeys = new Set([...Object.keys(DEFAULT_GROUPS), ...Object.keys(groups)]);
    for (const key of allKeys) {
      const def = DEFAULT_GROUPS[key] || {};
      const over = groups[key] || {};
      merged[key] = {
        primary: over.primary || def.primary || '',
        fallbacks: over.fallbacks || def.fallbacks || [],
        retry_on_failure: over.retry_on_failure !== undefined ? over.retry_on_failure : (def.retry_on_failure !== undefined ? def.retry_on_failure : true),
        description: over.description || def.description || key,
      };
    }
    return merged;
  }

  getGroup(name) {
    return this.groups[name] || null;
  }

  getAllGroups() {
    return { ...this.groups };
  }

  getActiveProvider(groupName) {
    return this._activeProvider[groupName] || this.groups[groupName]?.primary || null;
  }

  getAvailableProvider(groupName) {
    const group = this.groups[groupName];
    if (!group) return null;

    // Try active provider first
    const active = this._activeProvider[groupName] || group.primary;
    if (active && providerRegistry.isAvailable(active)) {
      return active;
    }

    // Fall through fallbacks
    const all = [group.primary, ...group.fallbacks];
    for (const provider of all) {
      if (providerRegistry.isAvailable(provider)) {
        this._activeProvider[groupName] = provider;
        return provider;
      }
    }

    return null;
  }

  markGroupFailure(groupName) {
    const group = this.groups[groupName];
    if (!group) return;

    const active = this._activeProvider[groupName] || group.primary;

    // If retry_on_failure is enabled, try fallback next time
    if (group.retry_on_failure) {
      const all = [group.primary, ...group.fallbacks];
      const idx = all.indexOf(active);
      if (idx >= 0 && idx < all.length - 1) {
        this._activeProvider[groupName] = all[idx + 1];
      }
    }
  }

  resetGroup(groupName) {
    const group = this.groups[groupName];
    if (!group) return;
    this._activeProvider[groupName] = group.primary;
  }

  getGroupStatus(groupName) {
    const group = this.groups[groupName];
    if (!group) return null;

    const all = [group.primary, ...group.fallbacks];
    const active = this.getActiveProvider(groupName);
    const available = this.getAvailableProvider(groupName);

    return {
      name: groupName,
      description: group.description,
      primary: group.primary,
      fallbacks: group.fallbacks,
      retry_on_failure: group.retry_on_failure,
      activeProvider: active,
      availableProvider: available,
      healthy: !!available,
      providers: all.map(p => ({
        name: p,
        status: providerRegistry.getStatus(p),
        isActive: p === active,
        isAvailable: providerRegistry.isAvailable(p),
      })),
    };
  }
}

export default GroupManager;
