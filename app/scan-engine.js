import axios from 'axios';
import EventEmitter from 'events';
import fs from 'fs';
import path from 'path';
import { WebScraper, GoogleDorker, RateLimiter, UserAgentRotator, fetchWithFallback } from './scraper.js';
import { deduplicateRecords } from './extractor.js';
import { insertCompany, insertEmailRecord } from './db.js';
import { verifyEmail } from './verifier.js';
import { AIAdvisor } from './ai-advisor.js';
import { sweepChamberToDatabase } from './chamber-importer.js';
import { sweepBBBToDatabase } from './bbb-importer.js';
import { sweep411ToDatabase } from './411-importer.js';
import { sweepMapsToDatabase } from './maps-importer.js';
import { sweepJobBankToDatabase } from './jobbank-importer.js';
import { sweepSMBToDatabase } from './smb-finder.js';

// ═══════════════════════════════════════════════════════════════════════
// OMEGA HEADHUNTER — Full-Economy Canadian Discovery Configuration
// ═══════════════════════════════════════════════════════════════════════

// YellowPages industry categories × cities — pages 1-50 auto-generated
const YP_INDUSTRIES = [
  'Business', 'Company', 'Services', 'Store', 'Office', 'Shop', 'Clinic',
  'Restaurant', 'Agency', 'Firm', 'Studio', 'Center', 'Consultant',
  'Contractor', 'Manufacturer', 'Supplier', 'Retail', 'Wholesale', 'Enterprise',
  'Technology+Companies', 'IT+Services', 'Software+Development', 'IT+Consulting',
  'Engineering+Firms', 'Consulting+Engineers', 'Management+Consulting',
  'Financial+Services', 'Accounting+Firms', 'Insurance+Companies',
  'Construction+Companies', 'General+Contractors',
  'Manufacturing', 'Industrial+Equipment',
  'Transportation+Companies', 'Logistics', 'Trucking+Companies',
  'Telecommunications', 'Internet+Services',
  'Biotechnology', 'Pharmaceutical+Companies', 'Medical+Equipment',
  'Environmental+Consulting', 'Energy+Companies',
  'Mining+Companies', 'Oil+Gas+Companies',
  'Advertising+Agencies', 'Marketing+Consultants',
  'Legal+Services', 'Law+Firms',
  'Architecture', 'Interior+Design',
  'Real+Estate+Companies', 'Property+Management',
  'Staffing+Agencies', 'Recruitment+Agencies',
  'Education+Training', 'Private+Schools',
  'Food+Processing', 'Agriculture',
  'Hotels+Motels', 'Travel+Agencies',
  'Security+Services', 'Cleaning+Services'
];

const YP_CITIES = [
  'Toronto+ON', 'Vancouver+BC', 'Montreal+QC', 'Calgary+AB', 'Ottawa+ON',
  'Edmonton+AB', 'Mississauga+ON', 'Winnipeg+MB', 'Quebec+QC', 'Hamilton+ON',
  'Kitchener+ON', 'London+ON', 'Halifax+NS', 'Victoria+BC', 'Saskatoon+SK',
  'Regina+SK', 'St.+Johns+NL', 'Kelowna+BC', 'Barrie+ON', 'Oshawa+ON',
  'Windsor+ON', 'Sherbrooke+QC', 'Sudbury+ON', 'Thunder+Bay+ON', 'Moncton+NB',
  'Surrey+BC', 'Burnaby+BC', 'Richmond+BC', 'Markham+ON', 'Vaughan+ON',
  'Gatineau+QC', 'Longueuil+QC', 'Brampton+ON', 'Laval+QC', 'Surrey+BC',
  'Lethbridge+AB', 'Red+Deer+AB', 'Kamloops+BC', 'Nanaimo+BC', 'Chilliwack+BC',
  'Guelph+ON', 'Cambridge+ON', 'Milton+ON', 'Waterloo+ON', 'Brantford+ON',
  'Kingston+ON', 'Niagara+Falls+ON', 'Peterborough+ON', 'Sarnia+ON',
  'Saint+John+NB', 'Fredericton+NB', 'Charlottetown+PE', 'Whitehorse+YT', 'Yellowknife+NT'
];

const YP_MAX_PAGES = 50;

function generateYPSeeds() {
  const seeds = [];
  for (const industry of YP_INDUSTRIES) {
    for (const city of YP_CITIES) {
      for (let page = 1; page <= YP_MAX_PAGES; page++) {
        seeds.push(`https://www.yellowpages.ca/search/si/${page}/${industry}/${city}`);
      }
    }
  }
  return seeds;
}

// ── Professional Targeted Query Strategy ──────────────────────────────
// These patterns yield company HOMEPAGES, not job boards
const TARGETED_QUERY_PATTERNS = [
  // Direct company website patterns
  '"{industry}" company "{city}" Canada official website',
  '"{industry}" "{city}" Canada "About Us"',
  '"{industry}" services "{city}" Canada',
  '"{industry}" solutions "{city}" Canada',
  '"{industry}" corporation "{city}" Canada',
  '"{industry}" ltd "{city}" Canada',
  '"{industry}" inc "{city}" Canada',
  
  // Industry association member directories
  'site:cata.ca "{industry}" "{city}"',
  'site:cca-acc.com "{industry}" "{city}"',
  'site:cba.org "{industry}" "{city}"',
  'site:cpa.ca "{industry}" "{city}"',
  'site:engineerscanada.ca "{industry}" "{city}"',
  'site:cma.ca "{industry}" "{city}"',
  
  // Business directories
  'site:canadabusinessnetwork.ca "{industry}" "{city}"',
  'site:innovation.ca "{industry}" "{city}"',
  'site:bdc.ca "{industry}" "{city}"',
  
  // Chamber of Commerce
  'site:ontariochamber.on.ca "{industry}" "{city}"',
  'site:bccc.bc.ca "{industry}" "{city}"',
  'site:ccq.qc.ca "{industry}" "{city}"',
  
  // Government supplier lists
  'site:buyandsell.gc.ca "{industry}" "{city}"',
  'site:merx.com "{industry}" "{city}"',
];

const TARGETED_INDUSTRIES = [
  'IT services', 'software development', 'cybersecurity', 'cloud consulting',
  'managed services', 'digital transformation', 'AI consulting',
  'engineering consulting', 'mechanical engineering', 'civil engineering',
  'electrical engineering', 'environmental engineering',
  'construction management', 'general contracting', 'commercial construction',
  'architecture', 'interior design', 'project management',
  'accounting', 'CPA', 'tax advisory', 'financial consulting',
  'law firm', 'corporate law', 'intellectual property law',
  'medical devices', 'biotechnology', 'pharmaceutical manufacturing',
  'renewable energy', 'environmental consulting',
  'logistics', 'supply chain', 'freight forwarding',
  'digital marketing', 'SEO agency', 'content marketing',
  'HR consulting', 'executive search', 'staffing'
];

const TARGETED_CITIES = [
  'Toronto', 'Vancouver', 'Montreal', 'Calgary', 'Ottawa', 'Edmonton',
  'Mississauga', 'Winnipeg', 'Quebec City', 'Hamilton', 'Kitchener',
  'London', 'Halifax', 'Victoria', 'Saskatoon', 'Regina', 'Kelowna',
  'Barrie', 'Oshawa', 'Windsor', 'Sherbrooke', 'Sudbury'
];

const MAPS_CATEGORIES = [
  'cybersecurity company',
  'IT services',
  'software company',
  'managed IT provider',
  'technology consulting'
];

const JOB_KEYWORDS = [
  'software developer', 'IT specialist', 'cybersecurity analyst', 'cloud engineer',
  'project manager', 'business analyst', 'accountant', 'CPA',
  'mechanical engineer', 'electrical engineer', 'civil engineer',
  'construction manager', 'site supervisor', 'estimator',
  'registered nurse', 'medical laboratory technologist', 'pharmacist',
  'marketing manager', 'digital marketing specialist', 'SEO specialist',
  'HR manager', 'recruiter', 'talent acquisition',
  'sales representative', 'account manager', 'business development'
];

const PROVINCES = ['ON', 'BC', 'QC', 'AB', 'MB', 'SK', 'NS', 'NB', 'NL', 'PE'];
const PROVINCE_NAMES = {
  ON: 'Ontario', BC: 'British Columbia', QC: 'Quebec', AB: 'Alberta',
  MB: 'Manitoba', SK: 'Saskatchewan', NS: 'Nova Scotia', NB: 'New Brunswick',
  NL: 'Newfoundland', PE: 'Prince Edward Island'
};

// ── Canadian Job Board Sources ──────────────────────────────────────────
const JOB_BOARD_SOURCES = [
  { 
    name: 'JobBank', 
    base: 'https://www.jobbank.gc.ca',
    params: '/jobsearch?keyword={keyword}&location={province}'
  },
  { 
    name: 'WorkBC', 
    base: 'https://www.workbc.ca',
    params: '/Jobs?keyword={keyword}&location={city}'
  },
  { 
    name: 'Alis', 
    base: 'https://alis.alberta.ca',
    params: '/look-for-work/search-jobs?keyword={keyword}&location={city}'
  },
  { 
    name: 'Jobillico', 
    base: 'https://www.jobillico.com',
    params: '/en/jobs?keyword={keyword}&location={city}'
  },
  { 
    name: 'Talent.com', 
    base: 'https://ca.talent.com',
    params: '/jobs?keyword={keyword}&location={city}'
  },
  { 
    name: 'Eluta', 
    base: 'https://www.eluta.ca',
    params: '/search?q={keyword}&l={city}'
  },
];

const CANADA_REGIONS = [
  'Ontario', 'Quebec', 'British Columbia', 'Alberta',
  'Toronto', 'Vancouver', 'Montreal', 'Ottawa', 'Calgary', 'Edmonton',
  'Manitoba', 'Saskatchewan', 'Nova Scotia', 'New Brunswick',
  'Mississauga', 'Winnipeg', 'Hamilton', 'Kitchener', 'London',
  'Halifax', 'Victoria', 'Saskatoon', 'Regina', 'Kelowna',
  'Newfoundland', 'Prince Edward Island'
];

// ── Junk Company Name Blocklist ─────────────────────────────────────
const BLOCKED_COMPANY_NAMES = new Set([
  'about', 'about us', 'contact', 'contact us', 'privacy', 'privacy policy',
  'terms', 'terms of use', 'terms of service', 'conditions', 'home', 'services',
  'careers', 'blog', 'support', 'legal', 'login', 'sign in', 'register',
  'more', 'read more', 'our team', 'follow us', 'join us', 'learn more',
  'menu', 'search', 'sitemap', 'subscribe', 'newsletter', 'faq', 'help',
  'products', 'solutions', 'resources', 'partners', 'investors', 'media',
  'press', 'news', 'events', 'gallery', 'portfolio', 'testimonials',
  'facebook', 'twitter', 'linkedin', 'instagram', 'youtube', 'google',
  'pinterest', 'tiktok', 'reddit', 'whatsapp', 'snapchat',
  'w3', 'www', 'http', 'https', 'javascript', 'css', 'html', 'xml',
  'undefined', 'null', 'true', 'false', 'error', 'loading',
  'goodfirms', 'sortlist', 'clutch', 'glassdoor', 'indeed', 'jobbank',
  'birdviewpsa', 'aeroleads', 'download', 'share', 'print', 'close',
  'back', 'next', 'previous', 'skip', 'cancel', 'submit', 'apply',
  'advertising opportunities', 'add your voice', 'our mission',
]);

const SKIP_HOST_PATTERNS = [
  'google.', 'duckduckgo.', 'linkedin.', 'facebook.', 'twitter.',
  'youtube.', 'instagram.', 'bing.', 'yahoo.', 'yellowpages.',
  'pagesjaunes.', 'yelp.', 'kijiji.', 'craigslist.', 'wikipedia.',
  'reddit.', 'pinterest.', 'tiktok.', 'amazon.', 'ebay.',
  'indeed.', 'glassdoor.', 'monster.', 'workopolis.', 'jobbank.',
  'goodfirms.', 'sortlist.', 'clutch.co', 'g2.com',
  'gov.ca', 'gc.ca', 'canada.ca'
];

export class ScanEngine extends EventEmitter {
  constructor(db, config) {
    super();
    this.db = db;
    this.config = config;
    this.state = {
      status: 'idle',
      totalCompanies: 0,
      processedCompanies: 0,
      emailsFound: 0,
      emailsRejected: 0,
      errors: 0,
      startedAt: null,
      estimatedRemainingSecs: null
    };
    this.active = false;
    this.abortController = null;
    
    // ✨ RESILIENCE: Persistent source stats for circuit breaker
    this.sourceStats = {
      duckduckgo: { success: 0, fail: 0, disabled: false },
      yellowpages: { success: 0, fail: 0, disabled: false },
      other: { success: 0, fail: 0, disabled: false }
    };
  }

  getState() { return { ...this.state }; }

  async start(options = {}) {
    if (this.state.status === 'running' || this.state.status === 'fetching') {
      this._log('warn', 'Discovery already running. Start request ignored.');
      return;
    }

    this.state.status = 'running';
    this.state.startedAt = new Date().toISOString();
    this.state.processedCompanies = 0;
    this.state.emailsFound = 0;
    this.state.emailsRejected = 0;
    this.state.errors = 0;
    this.active = true;
    this.abortController = new AbortController();

    this._emitProgress();
    this._log('info', `Discovery activated (industry: ${options.industry || 'all'})`);

    try {
      await this._runContinuousDiscovery(options);
      this.state.status = 'completed';
      this._log('info', 'Discovery reached current source limits.');
    } catch (e) {
      if (e.name === 'AbortError' || e.message === 'Aborted') {
        this.state.status = 'idle';
        this._log('info', 'Discovery stopped by user.');
      } else {
        this.state.status = 'idle';
        this.state.errors++;
        this._log('error', `Discovery error: ${e.message}`);
      }
    }

    this.active = false;
    this._emitProgress();
  }

  stop() {
    this.active = false;
    if (this.abortController) this.abortController.abort();
    this.state.status = 'idle';
    this._log('info', 'Discovery stopping...');
    this._emitProgress();
  }

  async _runContinuousDiscovery(options = {}) {
    const rateLimiter = new RateLimiter(this.config.domain_delay_ms || 1000);
    const uaRotator = new UserAgentRotator(this.config.user_agents || []);
    const scraper = new WebScraper(this.config, rateLimiter, uaRotator, this);
    const dorker = new GoogleDorker(this.config, rateLimiter, uaRotator, this);
    const aiAdvisor = new AIAdvisor(this.config);

    const engineRootDir = process.cwd().endsWith('backend') ? path.join(process.cwd(), '..') : process.cwd();
    const heartbeatPath = path.join(engineRootDir, 'backend', 'data', 'send_heartbeat.json');

    const updateHeartbeat = () => {
      try { fs.writeFileSync(heartbeatPath, JSON.stringify({ ts: Date.now() })); } catch {}
    };

    let cycleCount = 0;

    while (this.active) {
      if (this.abortController?.signal.aborted) break;

      this.state.status = 'fetching';
      this._emitProgress();
      cycleCount++;

      await this._maybeSyncPremiumDirectories(engineRootDir);

      // ── Phase 1: Process backlog of unscraped companies from DB ──────────
      // Always drain the DB backlog first before fetching new sources
      let dbBatch = [];
      try {
        dbBatch = this.db.prepare(`
          SELECT c.business_id, c.company_name, c.website
          FROM companies c
          WHERE c.website IS NOT NULL
            AND c.scraped_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM email_records er
              WHERE er.business_id = c.business_id
            )
          ORDER BY c.fetched_at DESC
          LIMIT 200
        `).all() || [];
      } catch {}

      const backlogSize = dbBatch.length;
      this._log('info', `[CYCLE ${cycleCount}] DB backlog: ${backlogSize} unscraped companies`);

      // ── Phase 2: Fetch new companies from web sources (every cycle) ──
      let sourceBatch = [];
      sourceBatch = await this._fetchCanadianCompanyPool(rateLimiter, uaRotator, options);

      const combinedBatch = deduplicateRecordsByCompany([...sourceBatch, ...dbBatch]);

      if (combinedBatch.length === 0) {
        this._log('info', 'No companies to process. Sleeping 5 minutes...');
        await this._sleep(5 * 60 * 1000);
        continue;
      }

      this.state.status = 'running';
      this.state.totalCompanies = combinedBatch.length;
      this.state.processedCompanies = 0;
      this._emitProgress();

      const COMPANY_CONCURRENCY = 5;
      const self2 = this;

      async function processCompany(company) {
        if (!self2.active || self2.abortController?.signal.aborted) return;
        updateHeartbeat();

        const normalizedCompany = {
          business_id: company.business_id || self2._idFrom('CA-AUTO', company.company_name || company.website || Date.now().toString()),
          company_name: company.company_name || self2._nameFromWebsite(company.website),
          website: company.website || null
        };

        if (!normalizedCompany.company_name) {
          return;
        }

        try {
          insertCompany(self2.db, normalizedCompany);

          if (!normalizedCompany.website) {
            normalizedCompany.website = await self2._discoverWebsite(normalizedCompany.company_name);
            if (normalizedCompany.website) {
              self2.db.prepare('UPDATE companies SET website = ? WHERE business_id = ?').run(normalizedCompany.website, normalizedCompany.business_id);
            } else {
              self2._log('info', `[SKIP] No website found for ${normalizedCompany.company_name}`);
              return;
            }
          }

          const websiteEmails = await scraper.scrapeCompany(normalizedCompany);
          const dorkEmails = await dorker.dorkCompany(normalizedCompany);
          const allEmails = deduplicateRecords([...websiteEmails, ...dorkEmails]);

          if (allEmails.length === 0) {
            try {
              const linkedInEmails = await self2._discoverLinkedInEmployees(normalizedCompany);
              allEmails.push(...linkedInEmails);
            } catch {}
          }

          const uniqueNew = deduplicateRecords(allEmails);
          let validCount = 0;

          // ✨ PARALLEL EMAIL VERIFICATION — batch of 10
          async function verifyBatch(records) {
            const BATCH_SIZE = 10;
            const results = [];
            for (let i = 0; i < records.length; i += BATCH_SIZE) {
              if (!self2.active || self2.abortController?.signal.aborted) break;
              const batch = records.slice(i, i + BATCH_SIZE);
              const settled = await Promise.allSettled(batch.map(async (record) => {
                if (!self2.active || self2.abortController?.signal.aborted) return null;
                self2._log('info', `[VERIFY] ${record.email}`);
                const allowGeneric = self2.config.discovery_allow_generic === true;
                const verification = await verifyEmail(record.email, { ...self2.config, allowGeneric });
                if (!verification.valid) {
                  self2.state.emailsRejected++;
                  self2._log('warn', `[REJECTED] ${record.email} (${verification.reason})`);
                  return null;
                }
                const verifiedRecord = {
                  ...record,
                  verified: 1,
                  verification_score: verification.score || (verification.fallback ? 0.4 : 0.7)
                };
                if (verifiedRecord.email_type === 'hr' || verifiedRecord.email_type === 'management') {
                  try {
                    const newsSnippet = await dorker.searchNews(verifiedRecord.company_name);
                    const aiIntro = await aiAdvisor.generateIntro(verifiedRecord.company_name, newsSnippet);
                    if (aiIntro) verifiedRecord.ai_intro = aiIntro;
                  } catch {}
                }
                insertEmailRecord(self2.db, verifiedRecord);
                return verifiedRecord;
              }));
              for (const r of settled) {
                if (r.status === 'fulfilled' && r.value) {
                  results.push(r.value);
                  validCount++;
                  self2._log('info', `[VERIFIED] ${r.value.email} (score: ${r.value.verification_score})`);
                }
              }
            }
            return results;
          }

          await verifyBatch(uniqueNew);

          self2.state.emailsFound += validCount;
          if (validCount > 0) {
            self2._log('info', `${normalizedCompany.company_name}: ${validCount} valid emails`);
          }
        } catch (e) {
          self2.state.errors++;
          self2._log('warn', `Company processing error (${normalizedCompany.company_name}): ${e.message}`);
        }

        try {
          self2.db.prepare("UPDATE companies SET scraped_at = datetime('now') WHERE business_id = ?").run(normalizedCompany.business_id);
        } catch(e) {}

        self2.state.processedCompanies++;
        self2._emitProgress();
      }

      for (let i = 0; i < combinedBatch.length && self.active; i += COMPANY_CONCURRENCY) {
        const batch = combinedBatch.slice(i, i + COMPANY_CONCURRENCY);
        await Promise.allSettled(batch.map(c => processCompany(c)));
      }
    }
  }

  async _maybeSyncPremiumDirectories(engineRootDir) {
    const statePath = path.join(engineRootDir, 'backend', 'data', 'premium_sync.json');
    const now = Date.now();
    const cooldownMs = 24 * 60 * 60 * 1000; // 24 hours — sites block frequent crawls

    let state = { lastTs: 0 };
    try {
      if (fs.existsSync(statePath)) {
        state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      }
    } catch {}

    if (now - (state.lastTs || 0) < cooldownMs) return;

    this._log('info', '[PREMIUM-SYNC] Starting synchronization of premium Canadian directories (Chamber, BBB, 411.ca)...');
    let totalImportedAll = 0;

    // 1. Chamber of Commerce
    try {
      const res = await sweepChamberToDatabase({ db: this.db, maxPages: state.lastTs ? 8 : 20, logger: (msg) => this._log('info', msg) });
      totalImportedAll += res.totalImported;
    } catch (e) {
      this._log('warn', `[PREMIUM-SYNC] Chamber sync failed: ${e.message}`);
    }

    // 2. BBB Canada
    try {
      const res = await sweepBBBToDatabase({ db: this.db, maxPages: state.lastTs ? 5 : 15, logger: (msg) => this._log('info', msg) });
      totalImportedAll += res.totalImported;
    } catch (e) {
      this._log('warn', `[PREMIUM-SYNC] BBB sync failed: ${e.message}`);
    }

    // 3. 411.ca Directory
    try {
      const res = await sweep411ToDatabase({ db: this.db, maxPages: state.lastTs ? 5 : 20, logger: (msg) => this._log('info', msg) });
      totalImportedAll += res.totalImported;
    } catch (e) {
      this._log('warn', `[PREMIUM-SYNC] 411 sync failed: ${e.message}`);
    }

    // 4. Google Maps (Puppeteer)
    try {
      await sweepMapsToDatabase({ db: this.db, logger: (msg) => this._log('info', msg) });
    } catch (e) {
      this._log('warn', `[PREMIUM-SYNC] Maps sync failed: ${e.message}`);
    }

    // 4.5 SMB Finder (Yelp, Yellow Pages, Bing Search)
    try {
      const smbResult = await sweepSMBToDatabase({ db: this.db, config: this.config, logger: (msg) => this._log('info', msg) });
      totalImportedAll += smbResult.totalImported;
      this._log('info', `[PREMIUM-SYNC] SMB Finder: +${smbResult.totalImported} businesses`);
    } catch (e) {
      this._log('warn', `[PREMIUM-SYNC] SMB Finder failed: ${e.message}`);
    }

    // 5. Job Bank Canada (government job board — no bot protection, always works)
    try {
      const res = await sweepJobBankToDatabase({
        db: this.db,
        maxPages: state.lastTs ? 3 : 5,
        logger: (msg) => this._log('info', msg)
      });
      totalImportedAll += res.totalImported;
      this._log('info', `[PREMIUM-SYNC] Job Bank: +${res.totalImported} companies`);
    } catch (e) {
      this._log('warn', `[PREMIUM-SYNC] Job Bank sync failed: ${e.message}`);
    }

    state = { lastTs: now, importedTotal: totalImportedAll };
    fs.writeFileSync(statePath, JSON.stringify(state));
    this._log('info', `[PREMIUM-SYNC] Premium sync complete: ${totalImportedAll} total new companies across all sources.`);
  }

  async _fetchCanadianCompanyPool(rateLimiter, uaRotator) {
    this._log('info', '[POOL] Expanding company pool from Canadian sources...');
    const queries = this._buildPoolQueries();
    const companies = [];
    const checkStmt = this.db.prepare('SELECT 1 FROM companies WHERE LOWER(company_name) = ? LIMIT 1');

    // ✨ Track source success/failure for circuit breaker + smart delays
    const sourceStats = {
      duckduckgo: { success: 0, fail: 0, lastRetry: 0 },
      bing: { success: 0, fail: 0, lastRetry: 0 },
      yellowpages: { success: 0, fail: 0, lastRetry: 0 },
      other: { success: 0, fail: 0, lastRetry: 0 },
    };

    const CONCURRENCY = 15;
    const self = this;

    async function processQuery(query) {
      if (!self.active) return;
      try {
        let sourceType = 'other';
        let originalUrl = query;

        if (query.includes('duckduckgo')) sourceType = 'duckduckgo';
        else if (query.includes('yellowpages')) sourceType = 'yellowpages';

        if (self.sourceStats[sourceType]?.disabled) return;

        let targetUrl = originalUrl;
        if (sourceType === 'duckduckgo' && self.sourceStats.duckduckgo.fail > 10) {
          const queryParam = originalUrl.split('q=')[1]?.split('&')[0];
          if (queryParam) {
            targetUrl = `https://www.bing.com/search?q=${queryParam}`;
            sourceType = 'bing';
            self._log('debug', `[POOL] [AUTO-SWITCH] Converting DuckDuckGo → Bing (${self.sourceStats.duckduckgo.fail} failures)`);
          }
        }

        const now = Date.now();
        if (!sourceStats[sourceType]) {
          sourceStats[sourceType] = { success: 0, fail: 0, lastRetry: 0 };
        }
        const lastRetry = sourceStats[sourceType].lastRetry || 0;
        const requiredDelay = sourceType === 'duckduckgo' ? 5000 : 1000;
        if (now - lastRetry < requiredDelay) {
          const waitTime = requiredDelay - (now - lastRetry);
          await new Promise(r => setTimeout(r, waitTime));
        }
        sourceStats[sourceType].lastRetry = Date.now();

        if (!targetUrl.startsWith('http')) {
          targetUrl = `https://www.yellowpages.ca/search/si/1/${encodeURIComponent(query)}/Canada`;
        }
        self._log('debug', `[POOL] [${sourceType.toUpperCase()}] Targeting: ${targetUrl.substring(0, 80)}...`);

        const result = await fetchWithFallback(targetUrl, self.config, uaRotator, rateLimiter);
        const html = (typeof result.data === 'string') ? result.data : '';
        if (!html || result.source === 'failed') {
          self.sourceStats[sourceType].fail++;
          sourceStats[sourceType].fail++;

          if (sourceType === 'duckduckgo' && self.sourceStats.duckduckgo.fail >= 30 && self.sourceStats.duckduckgo.success === 0) {
            self._log('warn', `🔴 [CIRCUIT-BREAKER] DuckDuckGo permanently blocked. Disabling and focusing on YellowPages + Bing.`);
            self.sourceStats.duckduckgo.disabled = true;
          }
          return;
        }

        self.sourceStats[sourceType].success++;
        sourceStats[sourceType].success++;

        const absLinks = html.match(/https?:\/\/[^\s"'<>]+/g) || [];
        const relLinks = html.match(/\/gourl\/[^\s"'<>]+/g) || [];
        const links = [...absLinks, ...relLinks];

        self._log('debug', `[POOL] Links harvested: ${absLinks.length} abs, ${relLinks.length} rel via ${result.source}`);
        if (relLinks.length > 0) {
          self._log('debug', `[YP-MATCH] Found ${relLinks.length} potential YP redirects!`);
        }

        for (const rawLink of links) {
          let normalized = rawLink;

          if (normalized.startsWith('/gourl/')) {
            normalized = 'https://www.yellowpages.ca' + normalized;
          }

          const parsed = safeUrl(normalized);
          if (!parsed) continue;

          const cleanLink = sanitizeLink(normalized);
          if (!cleanLink) continue;

          const host = parsed.hostname.toLowerCase();

          if (SKIP_HOST_PATTERNS.some((pattern) => host.includes(pattern))) continue;

          if (host.includes('greenhouse.io') || host.includes('lever.co') || host.includes('teamtailor.com')) {
            const companyName = self._extractAtsCompanyName(normalized);
            if (!companyName) continue;
            companies.push({
              business_id: self._idFrom('CA-ATS', companyName),
              company_name: companyName,
              website: null
            });
            continue;
          }

          if (normalized.includes('/gourl/') && normalized.includes('redirect=')) {
            try {
              const encodedUrl = normalized.split('redirect=')[1]?.split('&')[0];
              if (encodedUrl) {
                const decoded = decodeURIComponent(encodedUrl);
                const parsedRedirect = safeUrl(decoded);
                if (parsedRedirect) {
                  const rHost = parsedRedirect.hostname.toLowerCase();
                  if (!SKIP_HOST_PATTERNS.some(p => rHost.includes(p))) {
                    const rCompanyName = self._nameFromWebsite(parsedRedirect.origin);
                    if (rCompanyName) {
                      const company = {
                        business_id: self._idFrom('CA-YP', `${rCompanyName}-${rHost}`),
                        company_name: rCompanyName,
                        website: parsedRedirect.origin
                      };
                      const exists = checkStmt.get(rCompanyName.toLowerCase());
                      if (!exists) {
                        self._log('debug', `[YP-DECODE] Found & Saving: ${rCompanyName}`);
                        insertCompany(self.db, company);
                        companies.push(company);
                      }
                      continue;
                    }
                  }
                }
              }
            } catch (err) {
              self._log('warn', `[YP-DECODE] Failed to decode redirect: ${err.message}`);
            }
          }

          const companyName = self._nameFromWebsite(parsed.origin);
          if (companyName) {
            const company = {
              business_id: self._idFrom('CA-WEB', `${companyName}-${host}`),
              company_name: companyName,
              website: parsed.origin
            };
            const exists = checkStmt.get(companyName.toLowerCase());
            if (!exists) {
              self._log('debug', `[WEB-POOL] Found & Saving: ${companyName}`);
              insertCompany(self.db, company);
              companies.push(company);
            }
          }
        }
      } catch (err) {
        self._log('warn', `[POOL] Query error: ${err.message}`);
      }
    }

    for (let i = 0; i < queries.length && self.active; i += CONCURRENCY) {
      const batch = queries.slice(i, i + CONCURRENCY);
      await Promise.allSettled(batch.map(q => processQuery(q)));
    }

    // ✨ Log source statistics for monitoring
    const total = Object.values(this.sourceStats).reduce((sum, s) => sum + s.success + s.fail, 0);
    if (total > 0) {
      this._log('info', `[POOL] 📊 Source Stats: DuckDuckGo(${this.sourceStats.duckduckgo.success}/${this.sourceStats.duckduckgo.success + this.sourceStats.duckduckgo.fail}${this.sourceStats.duckduckgo.disabled ? ' DISABLED' : ''}), YellowPages(${this.sourceStats.yellowpages.success}/${this.sourceStats.yellowpages.success + this.sourceStats.yellowpages.fail})`);
    }
    this._log('info', `[POOL] Cycle complete. Discovered ${companies.length} companies total.`);
    return companies;
  }

  _buildPoolQueries() {
    const queries = [];
    const self = this;
    
    // ✨ Deterministic shuffle seed based on cycle for query rotation
    const cycleSeed = (self.state.cycleCount || 0) * 1000;
    
    function seededShuffle(array, seed) {
      const arr = [...array];
      let s = seed;
      for (let i = arr.length - 1; i > 0; i--) {
        s = (s * 1664525 + 1013904223) >>> 0;
        const j = s % (i + 1);
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // PRIORITY 1: YellowPages — Direct business listings (highest yield)
    // ═══════════════════════════════════════════════════════════════════
    const ypSeeds = generateYPSeeds();
    const shuffledYP = seededShuffle(ypSeeds, cycleSeed).slice(0, 300); // 300 YP URLs per cycle
    queries.push(...shuffledYP);
    
    // ═══════════════════════════════════════════════════════════════════
    // PRIORITY 2: Targeted industry/city queries — Company homepages
    // ═══════════════════════════════════════════════════════════════════
    const industriesToUse = seededShuffle(TARGETED_INDUSTRIES, cycleSeed + 1).slice(0, 15);
    const citiesToUse = seededShuffle(TARGETED_CITIES, cycleSeed + 2).slice(0, 10);
    const patternsToUse = seededShuffle(TARGETED_QUERY_PATTERNS, cycleSeed + 3).slice(0, 8);
    
    for (const industry of industriesToUse) {
      for (const city of citiesToUse) {
        for (const pattern of patternsToUse) {
          const q = pattern.replace('{industry}', industry).replace('{city}', city);
          const encoded = encodeURIComponent(q);
          // Alternate between Bing (better for these patterns) and Startpage
          if (Math.random() > 0.3) {
            queries.push(`https://www.bing.com/search?q=${encoded}`);
          } else {
            queries.push(`https://www.startpage.com/do/dsearch?query=${encoded}&cat=web`);
          }
        }
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // PRIORITY 3: Canadian Job Boards — Companies actively hiring
    // ═══════════════════════════════════════════════════════════════════
    const keywordsToUse = seededShuffle(JOB_KEYWORDS, cycleSeed + 4).slice(0, 10);
    const provincesToUse = seededShuffle(PROVINCES, cycleSeed + 5).slice(0, 6);
    const jobBoardsToUse = seededShuffle(JOB_BOARD_SOURCES, cycleSeed + 6);
    
    for (const board of jobBoardsToUse) {
      for (const keyword of keywordsToUse) {
        for (const prov of provincesToUse) {
          const city = PROVINCE_NAMES[prov] || prov;
          const q = encodeURIComponent(`"${keyword}" "${city}" ${board.name}`);
          const url = `${board.base}${board.params.replace('{province}', prov).replace('{city}', encodeURIComponent(city)).replace('{keyword}', encodeURIComponent(keyword))}`;
          queries.push(url);
        }
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // PRIORITY 4: Google Maps / Places — Physical business locations
    // ═══════════════════════════════════════════════════════════════════
    const mapCategoriesToUse = seededShuffle(MAPS_CATEGORIES, cycleSeed + 7).slice(0, 8);
    const mapCitiesToUse = seededShuffle(TARGETED_CITIES, cycleSeed + 8).slice(0, 6);
    
    for (const category of mapCategoriesToUse) {
      for (const city of mapCitiesToUse) {
        const q = encodeURIComponent(`${category} near ${city} Canada`);
        queries.push(`https://www.bing.com/maps?q=${q}`);
        queries.push(`https://www.google.com/maps/search/${q}`);
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // PRIORITY 5: LinkedIn Company Search via Bing
    // ═══════════════════════════════════════════════════════════════════
    const linkedInIndustries = seededShuffle(TARGETED_INDUSTRIES, cycleSeed + 9).slice(0, 5);
    const linkedInCities = seededShuffle(TARGETED_CITIES, cycleSeed + 10).slice(0, 5);
    
    for (const industry of linkedInIndustries) {
      for (const city of linkedInCities) {
        const q = encodeURIComponent(`site:linkedin.com/company "${industry}" "${city}" Canada`);
        queries.push(`https://www.bing.com/search?q=${q}`);
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // PRIORITY 6: Government / Association directories
    // ═══════════════════════════════════════════════════════════════════
    const govSources = [
      'site:buyandsell.gc.ca "supplier" Canada',
      'site:merx.com "contract" Canada',
      'site:canadabusinessnetwork.ca "company" Canada',
      'site:innovation.ca "member" Canada',
      'site:bdc.ca "entrepreneur" Canada',
      'site:edc.ca "exporter" Canada',
    ];
    for (const src of govSources) {
      queries.push(`https://www.bing.com/search?q=${encodeURIComponent(src)}`);
      queries.push(`https://www.startpage.com/do/dsearch?query=${encodeURIComponent(src)}&cat=web`);
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // FINAL: Shuffle and return
    // ═══════════════════════════════════════════════════════════════════
    const finalShuffled = seededShuffle(queries, cycleSeed + 100);
    return finalShuffled.slice(0, 800); // 800 queries per cycle (was 500)
  }

  _extractAtsCompanyName(url) {
    try {
      if (url.includes('boards.greenhouse.io/')) {
        const value = url.split('boards.greenhouse.io/')[1]?.split('/')[0];
        return normalizeCompanyName(value);
      }
      if (url.includes('jobs.lever.co/')) {
        const value = url.split('jobs.lever.co/')[1]?.split('/')[0];
        return normalizeCompanyName(value);
      }
      if (url.includes('.teamtailor.com')) {
        const value = new URL(url).hostname.split('.')[0];
        return normalizeCompanyName(value);
      }
    } catch {}
    return null;
  }

  _nameFromWebsite(website) {
    try {
      const host = new URL(website).hostname.replace(/^www\./i, '');
      const root = host.split('.')[0];
      return normalizeCompanyName(root);
    } catch {
      return null;
    }
  }

  _idFrom(prefix, seed) {
    return `${prefix}-${Buffer.from(String(seed)).toString('hex').slice(0, 14)}`;
  }

  async _discoverWebsite(companyName) {
    try {
      const query = encodeURIComponent(`"${companyName}" Canada official site`);
      const response = await axios.get(`https://html.duckduckgo.com/html/?q=${query}&kl=ca-en`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' },
        timeout: 12000
      });
      const urlMatches = response.data.match(/href="(https?:\/\/[^"]*)"/g) || [];
      for (const match of urlMatches) {
        const url = match.replace('href="', '').replace('"', '');
        const parsed = safeUrl(url);
        if (!parsed) continue;

        const host = parsed.hostname.toLowerCase();
        if (SKIP_HOST_PATTERNS.some((p) => host.includes(p))) continue;
        return parsed.origin;
      }
      await this._sleep(1200);
    } catch {}
    return null;
  }

  async _discoverLinkedInEmployees(company) {
    if (!company.website) return [];
    try {
      const domain = new URL(company.website).hostname.replace('www.', '');
      const query = encodeURIComponent(`"${company.company_name}" ("HR" OR "Recruiter" OR "Talent" OR "CEO") site:ca.linkedin.com/in`);
      const response = await axios.get(`https://html.duckduckgo.com/html/?q=${query}&kl=ca-en`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' },
        timeout: 8000
      });

      const names = new Set();
      const titleTags = response.data.match(/<a[^>]+class="result__a"[^>]*>([^<]+)<\/a>/g) || [];
      for (const match of titleTags) {
        let text = match.replace(/<[^>]+>/g, '').trim();
        text = text.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
        const parts = text.split('-');
        if (parts.length > 1) {
          const fullName = parts[0].trim().toLowerCase();
          if (fullName.includes(' ') && !fullName.includes('...')) {
            names.add(fullName.replace(/[|()]/g, '').trim());
          }
        }
      }

      const emails = [];
      let count = 0;
      for (const fullName of names) {
        if (count >= 3) break;
        const parts = fullName.split(' ').filter(Boolean);
        if (parts.length < 2) continue;
        const first = parts[0].replace(/[^a-z]/g, '');
        const last = parts[parts.length - 1].replace(/[^a-z]/g, '');
        if (!first || !last) continue;
        emails.push({
          email: `${first}.${last}@${domain.toLowerCase()}`,
          source: 'linkedin',
          company_name: company.company_name,
          business_id: company.business_id,
          website: company.website,
          found_date: new Date().toISOString()
        });
        count++;
      }
      await this._sleep(1000);
      return emails;
    } catch {
      return [];
    }
  }

  _sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

  _emitProgress() {
    this.emit('scan_progress', {
      processed: this.state.processedCompanies,
      total: this.state.totalCompanies,
      emails_found: this.state.emailsFound,
      emails_rejected: this.state.emailsRejected,
      errors: this.state.errors,
      estimated_remaining_secs: this.state.estimatedRemainingSecs,
      status: this.state.status
    });
  }

  _log(level, message) {
    this.emit('log', { level, message, ts: new Date().toISOString() });
  }
}

function safeUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function sanitizeLink(url) {
  if (!url) return null;
  return url
    .replace(/[)"'>,]+$/g, '')
    .replace(/^https?:\/\/duckduckgo\.com\/l\/\?uddg=/i, '');
}

function normalizeCompanyName(raw) {
  if (!raw) return null;
  const value = raw
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s&.-]/gu, '')
    .trim();
  if (!value || value.length < 3) return null;
  // [HEADHUNTER] Block junk names
  if (BLOCKED_COMPANY_NAMES.has(value.toLowerCase())) return null;
  return value
    .split(' ')
    .map((part) => part ? part.charAt(0).toUpperCase() + part.slice(1) : part)
    .join(' ');
}

function deduplicateRecordsByCompany(records) {
  const byKey = new Map();
  for (const row of records) {
    const name = (row.company_name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, row);
      continue;
    }
    if (!existing.website && row.website) byKey.set(key, row);
  }
  return Array.from(byKey.values());
}
