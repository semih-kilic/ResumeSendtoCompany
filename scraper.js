import axios from 'axios';
import * as cheerio from 'cheerio';
import { extractEmails, classifyEmail } from './extractor.js';
import { CircuitBreaker, RetryManager } from './resilience-manager.js';
import providerRegistry from './provider-registry.js';
import AdaptiveProviderEngine from './adaptive-provider-engine.js';

// [HEADHUNTER] Expanded keywords for Canadian bilingual sites
const SMART_KEYWORDS = [
  'contact', 'about', 'team', 'career', 'careers', 'jobs', 'hiring',
  'join', 'work-with-us', 'employment', 'opportunities', 'staff',
  'people', 'leadership', 'management', 'who-we-are', 'our-team',
  'info', 'get-in-touch', 'reach-us', 'connect',
  // French
  'nous-joindre', 'equipe', 'carrieres', 'emplois', 'a-propos',
  'contactez', 'coordonnees', 'recrutement',
  // Finnish (legacy)
  'yhteystiedot', 'rekry', 'meist', 'tiimi', 'ota-yhteytt'
];

export class RateLimiter {
// ... existing code ...
  constructor(defaultDelayMs = 1000) {
    this.delays = new Map();
    this.defaultDelay = defaultDelayMs;
  }

  async waitForDomain(domain) {
    const now = Date.now();
    const last = this.delays.get(domain) || 0;
    const elapsed = now - last;
    
    if (elapsed < this.defaultDelay) {
      await new Promise(r => setTimeout(r, this.defaultDelay - elapsed));
    }
    
    this.delays.set(domain, Date.now());
  }
}

export class UserAgentRotator {
  constructor(agents) {
    this.agents = agents;
    this.index = 0;
  }

  next() {
    const agent = this.agents[this.index % this.agents.length];
    this.index++;
    return agent;
  }
}

export class WebScraper {
  constructor(config, rateLimiter, uaRotator, eventEmitter) {
    this.config = config;
    this.concurrency = config.concurrency || 20;
    this.timeout = (config.request_timeout_secs || 10) * 1000;
    this.rateLimiter = rateLimiter;
    this.uaRotator = uaRotator;
    this.eventEmitter = eventEmitter;
    this.activeTasks = 0;
    
    // ✨ RESILIENCE: Circuit breakers for each provider
    this.zenrowsBreaker = new CircuitBreaker('zenrows-proxy', { 
      failureThreshold: 3, 
      timeoutSecs: 600, // 10 min
    });
    this.stealthBreaker = new CircuitBreaker('stealth-fetch', { 
      failureThreshold: 5, 
      timeoutSecs: 300, // 5 min
    });
    this.retryManager = new RetryManager({
      maxRetries: 2,
      initialDelayMs: 3000,
      maxDelayMs: 20000,
    });
    
    // ✨ Track quota exhaustion
    this.quotaExhaustedUntil = { zenrows: 0 };
  }

  async scrapeCompany(company) {
    const results = [];
    if (!company.website) return results;

    let baseUrl = company.website;
    if (!baseUrl.startsWith('http')) baseUrl = `https://${baseUrl}`;
    
    try {
      const { hostname: domain } = new URL(baseUrl);
      
      // ✨ Check if scraper is healthy before proceeding
      if (this.stealthBreaker.state === 'OPEN') {
        this._log('warn', `[CIRCUIT-OPEN] Web scraper circuit breaker is OPEN. Skipping ${company.company_name}.`);
        return results;
      }
      
      // 1. Scrape base URL
      const mainPage = await this._fetchAndExtract(baseUrl, domain);
      results.push(...mainPage.emails);

      // 2. Extract best links from main page
      const subLinks = this._extractLinks(mainPage.html, baseUrl, domain);
      
      // 3. Scrape sub-pages (with circuit breaker check)
      for (const subUrl of subLinks) {
        if (this.stealthBreaker.state === 'OPEN') {
          this._log('info', `[CIRCUIT-OPEN] Stopping sub-page scraping due to repeated failures.`);
          break;
        }
        const subPage = await this._fetchAndExtract(subUrl, domain);
        results.push(...subPage.emails);
      }
      
      // Record success for circuit breaker recovery
      this.stealthBreaker.recordSuccess();
    } catch (e) {
      this._log('warn', `Failed to scrape ${company.company_name}: ${e.message}`);
      this.stealthBreaker.recordFailure();
    }
    
    // Deduplicate and map
    const uniqueEmails = [...new Set(results)];
    return uniqueEmails.map(email => ({
      company_name: company.company_name,
      business_id: company.business_id,
      website: company.website,
      email: email.toLowerCase(),
      email_type: classifyEmail(email),
      source: 'website'
    }));
  }

  _extractLinks(html, baseUrl, domain) {
    if (!html) return [];
    const $ = cheerio.load(html);
    const links = new Set();
    const mailtoEmails = [];
    
    $('a[href]').each((_, el) => {
      try {
        const href = $(el).attr('href') || '';
        const text = $(el).text().toLowerCase();

        // [HEADHUNTER] Capture mailto: links directly — high confidence emails
        if (href.toLowerCase().startsWith('mailto:')) {
          const email = href.replace(/^mailto:/i, '').split('?')[0].trim();
          if (email && email.includes('@')) {
            mailtoEmails.push(email);
          }
          return;
        }

        const url = new URL(href, baseUrl);
        
        // Only internal links within the same domain
        if (url.hostname === domain) {
          const path = url.pathname.toLowerCase();
          if (SMART_KEYWORDS.some(kw => path.includes(kw) || text.includes(kw))) {
            links.add(url.toString());
          }
        }
      } catch (e) {}
    });
    
    // Store mailto emails on the instance for later retrieval
    this._lastMailtoEmails = mailtoEmails;
    return Array.from(links).slice(0, 8); // [HEADHUNTER] Max 8 relevant sub-pages (was 5)
  }

  /**
   * Routes a request through ScraperAPI if a key is provided.
   */
  _buildUrl(targetUrl) {
    const key = this.config.scraperapi_key || this.config.scraping?.scraperapi_key;
    if (key) {
      return `http://api.scraperapi.com?api_key=${key}&url=${encodeURIComponent(targetUrl)}`;
    }
    return targetUrl;
  }

  async _fetchAndExtract(url, _domain) {
    try {
      // ✨ Use RetryManager for transient errors
      let html = null;
      let source = 'failed';
      
      const fetchOperation = async () => {
        const result = await fetchWithFallback(url, this.config, this.uaRotator, this.rateLimiter, this.eventEmitter);
        if (result.data && result.data.length > 100) {
          source = result.source;
          return result.data;
        }
        throw new Error(`Empty response from ${result.source}`);
      };
      
      // Retry with exponential backoff for transient failures
      html = await this.retryManager.execute(fetchOperation, url);
      
      if (!html || typeof html !== 'string') {
        this._log('warn', `No HTML content retrieved for ${url}`);
        this.stealthBreaker.recordFailure();
        return { html: null, meta: '', emails: [], linkedin_url: null };
      }

      if (source === 'direct-stealth') {
        await new Promise(r => setTimeout(r, 2000));
      }

      const metaMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
      const meta = metaMatch ? metaMatch[1] : '';

      const $ = cheerio.load(html);
      
      // [OMEGA] Extract LinkedIn links directly from the website (Free & Unlimited)
      const linkedInLinks = [];
      $('a[href*="linkedin.com/"]').each((_, el) => {
        const href = $(el).attr('href');
        if (href && (href.includes('/company/') || href.includes('/in/'))) {
          linkedInLinks.push(href.split('?')[0].replace(/\/$/, ''));
        }
      });

      const mailtoEmails = [];
      $('a[href^="mailto:"]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const email = href.replace(/^mailto:/i, '').split('?')[0].trim().toLowerCase();
        if (email && email.includes('@') && !email.includes(' ')) {
          mailtoEmails.push(email);
        }
      });

      const regexEmails = extractEmails(html);
      const allEmails = [...new Set([...mailtoEmails, ...regexEmails])];

      return {
        html,
        meta,
        emails: allEmails,
        linkedin_url: linkedInLinks.length > 0 ? linkedInLinks[0] : null
      };
    } catch (e) {
      this._log('error', `[FETCH-FAILED] ${url}: ${e.message}`);
      this.stealthBreaker.recordFailure();
      return { html: null, meta: '', emails: [], linkedin_url: null };
    }
  }

  /**
   * Automatically finds a LinkedIn profile URL for a company or person.
   * [OMEGA] Uses high-precision dorking.
   */
  async findLinkedInProfile(companyName, personName = null, website = null) {
    // Priority 1: If we have a website, scrape it directly (Free & High Confidence)
    if (website) {
      this._log('info', `[ENRICHMENT] Priority 1: Scraping website for LinkedIn: ${website}`);
      const siteData = await this._fetchAndExtract(website, new URL(website.startsWith('http') ? website : `https://${website}`).hostname);
      if (siteData.linkedin_url) {
        this._log('info', `[ENRICHMENT] Found LinkedIn on-site: ${siteData.linkedin_url}`);
        return siteData.linkedin_url;
      }
    }

    // Priority 2: Search Engine Dorking (Fallback)
    const queryTerm = personName ? `"${personName}" ${companyName}` : `${companyName} Canada`;
    const query = encodeURIComponent(`site:linkedin.com/${personName ? 'in' : 'company'}/ ${queryTerm}`);
    
    const searchUrl = `https://www.google.com/search?q=${query}&gbv=1`;

    try {
      const { data: html, source } = await fetchWithFallback(searchUrl, this.config, this.uaRotator, this.rateLimiter, this.eventEmitter);
      
      if (!html || html.length < 500) {
        this._log('warn', `[LINKEDIN-SEARCH] ${source} returned empty/short HTML (${html?.length || 0} bytes)`);
        const ddgUrl = `https://duckduckgo.com/html/?q=${query}`;
        const { data: ddgHtml, source: ddgSource } = await fetchWithFallback(ddgUrl, this.config, this.uaRotator, this.rateLimiter, this.eventEmitter);
        if (ddgHtml) return this._parseLinkedInLinks(ddgHtml, ddgSource);
        return null;
      }

      return this._parseLinkedInLinks(html, source);
    } catch (e) {
      this._log('warn', `[LINKEDIN-SEARCH] Fatal Error for ${companyName}: ${e.message}`);
      return null;
    }
  }

  _parseLinkedInLinks(html, source) {
    const $ = cheerio.load(html);
    const links = new Set();
    
    // Debug: Log total links found on page to see if we're even getting a real search page
    const totalLinks = $('a').length;
    
    $('a').each((i, el) => {
      let href = $(el).attr('href');
      if (!href) return;

      if (href.includes('url?q=')) {
        href = href.split('url?q=')[1].split('&')[0];
      }

      try {
        const decoded = decodeURIComponent(href);
        if (decoded.includes('linkedin.com/company/') || decoded.includes('linkedin.com/in/')) {
          const cleanLink = decoded.split('?')[0].split('&')[0].replace(/\/$/, '');
          if (cleanLink.startsWith('http')) {
            links.add(cleanLink);
          }
        }
      } catch {}
    });

    const resultList = Array.from(links);
    if (resultList.length > 0) {
      this._log('info', `[LINKEDIN-PARSE] Found ${resultList.length} candidates from ${source}`);
      return resultList[0];
    }
    
    this._log('warn', `[LINKEDIN-PARSE] Zero LinkedIn links found in ${totalLinks} total anchors from ${source}`);
    return null;
  }

  _log(level, message) {
    if (this.eventEmitter) {
      this.eventEmitter.emit('log', { level, message, ts: new Date().toISOString() });
    }
  }
}

export class GoogleDorker {
  constructor(config, rateLimiter, uaRotator, eventEmitter) {
    this.config = config;
    this.delayMs = (config.google_delay_secs || 5) * 1000;
    this.rateLimiter = rateLimiter;
    this.uaRotator = uaRotator;
    this.eventEmitter = eventEmitter;
    this.timeout = 15000;
    this.stealthBreaker = new CircuitBreaker('google-dorker', { 
      failureThreshold: 3, 
      timeoutSecs: 300 
    });
  }

  _buildUrl(targetUrl) {
    const key = this.config.scraperapi_key || this.config.scraping?.scraperapi_key;
    if (key) {
      return `http://api.scraperapi.com?api_key=${key}&url=${encodeURIComponent(targetUrl)}`;
    }
    return targetUrl;
  }

  buildQuery(domain) {
    return `site:${domain} (email OR contact OR hr OR rekrytointi OR careers)`;
  }

  async dorkCompany(company) {
    const isEnabled = this.config?.scraping?.enable_dorking ?? this.config?.enable_dorking ?? false;
    if (!isEnabled) return [];

    // Skip dork if circuit breaker is open — saves time
    if (this.stealthBreaker && !this.stealthBreaker.isAvailable()) return [];

    await this.rateLimiter.waitForDomain('duckduckgo.com');
    const emails = [];

    try {
      const query = encodeURIComponent(`"${company.company_name}" (email OR contact) (IT OR Engineer OR CTO OR HR)`);
      this._log('info', `[DORK] Searching for technical contacts at: ${company.company_name}`);

      // Single attempt with short timeout — don't block pipeline on dork failures
      const searchUrl = `https://html.duckduckgo.com/html/?q=${query}&kl=ca-en`;
      let resultsHtml = '';

      try {
        const res = await axios.get(searchUrl, {
          timeout: 6000, // Fast timeout — dork is best-effort only
          headers: { 'User-Agent': this.uaRotator.next(), 'Accept-Language': 'en-CA,en;q=0.9' },
          validateStatus: s => s < 500
        });
        if (res.data && res.data.length > 200) resultsHtml = res.data;
      } catch {
        this.stealthBreaker.recordFailure();
        return [];
      }
      this.stealthBreaker.recordSuccess();

      const extracted = extractEmails(resultsHtml);
      for (const email of extracted) {
        emails.push({
          business_id: company.business_id,
          company_name: company.company_name,
          website: company.website,
          email: email.toLowerCase(),
          source: 'dorking',
          email_type: classifyEmail(email),
          discovered_at: new Date().toISOString()
        });
      }
      return emails;
    } catch (e) {
      this._log('warn', `[DORK] Failed for ${company.company_name}: ${e.message}`);
      this.stealthBreaker.recordFailure();
      return [];
    }
  }

  /**
   * Performs a focused news search for the company to provide deep context for AI.
   * [OMEGA] Tiered Fallback: ScraperAPI -> Direct Google -> Direct DuckDuckGo
   */
  async searchNews(companyName) {
    const query = encodeURIComponent(`"${companyName}" Canada company news 2024 2025`);
    const urls = [
      this._buildUrl(`https://www.google.com/search?q=${query}&gbv=1`), // Tier 1: ScraperAPI or Direct Google
      `https://duckduckgo.com/html/?q=${query}` // Tier 2: DuckDuckGo (Easier to scrape for free)
    ];

    for (const url of urls) {
      try {
        const response = await axios.get(url, { 
          timeout: 15000,
          headers: { 'User-Agent': this.uaRotator.next() }
        });
        if (response.data && response.data.length > 500) {
          return response.data.replace(/<[^>]*>/g, ' ').substring(0, 1000);
        }
      } catch (e) {
        if (e.response?.status === 403) {
          this._log('warn', `[SEARCH] Tier failed (403), trying next fallback...`);
          continue;
        }
      }
    }
  }


  _log(level, message) {
    if (this.eventEmitter) {
      this.eventEmitter.emit('log', { level, message, ts: new Date().toISOString() });
    }
  }
}

/* Provider health is managed by backend/provider-registry.js */

/**
 * Enhanced Fetch with Automatic Multi-Provider Fallback
 * Uses AdaptiveProviderEngine for ZERO DOWNTIME
 * Chain: Premium APIs → Free Proxies → Stealth Direct Fetch
 */
export async function fetchWithFallback(url, config, uaRotator, rateLimiter, eventEmitter = null) {
  const _log = (level, message) => {
    if (eventEmitter) {
      if (typeof eventEmitter.emit === 'function') {
        eventEmitter.emit('log', { level, message, ts: new Date().toISOString() });
      } else if (typeof eventEmitter === 'function') {
        eventEmitter({ level, message, ts: new Date().toISOString() });
      }
    } else {
      console[level === 'error' ? 'error' : 'warn'](`[OMEGA] ${message}`);
    }
  };

  // Initialize adaptive engine with current config
  const engine = new AdaptiveProviderEngine(config, { 
    log: _log,
    info: (msg) => _log('info', msg),
    warn: (msg) => _log('warn', msg),
    error: (msg) => _log('error', msg),
    debug: (msg) => _log('debug', msg)
  });

  // Wait for domain rate limiting
  const domain = new URL(url).hostname;
  await rateLimiter.waitForDomain(domain);

  // Use adaptive engine
  const result = await engine.fetch(url, {
    'User-Agent': uaRotator.next()
  });

  if (result.success) {
    _log('info', `✅ Fetch successful via ${result.source}`);
    return { data: typeof result.data === 'string' ? result.data : '', source: result.source };
  } else {
    _log('error', `❌ All providers failed for ${url}`);
    return { data: '', source: 'failed' };
  }
}

