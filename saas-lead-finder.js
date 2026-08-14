import axios from 'axios';
import { extractEmails, classifyEmail } from './extractor.js';
import { insertCompany, insertEmailRecord } from './db.js';
import { verifyEmail } from './verifier.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ═══════════════════════════════════════════════════════════════════════
// OMEGA V3 — SaaS Lead Finder (CyberSec Pro Google Discovery Engine)
// Searches Google/DuckDuckGo for IT, cybersecurity, MSP companies
// and extracts contact emails for the SaaS outreach pipeline.
// ═══════════════════════════════════════════════════════════════════════

const SAAS_SEARCH_QUERIES = [
  // Professional Services
  'consulting firm', 'law firm', 'accounting firm', 'marketing agency',
  'recruitment agency', 'pr agency', 'business services company', 'architectural firm',
  
  // Finance & Healthcare
  'financial services company', 'wealth management firm', 'insurance agency',
  'healthcare provider', 'medical clinic', 'dental practice', 'pharmaceutical company',
  
  // Real Estate & Construction
  'real estate agency', 'property management company', 'construction company',
  'engineering firm', 'commercial real estate firm', 'contracting company',
  
  // Manufacturing & Logistics
  'manufacturing company', 'logistics company', 'supply chain management',
  'freight forwarding company', 'warehousing company', 'packaging company',
  
  // Technology & IT (Keeping the core)
  'software development company', 'managed IT services provider MSP', 'cybersecurity firm',
  'SaaS platform company', 'digital transformation company',
  
  // Retail & Hospitality
  'retail company', 'e-commerce business', 'hospitality management',
  'hotel group', 'restaurant group', 'event management company',
  
  // Miscellaneous
  'education provider', 'training company', 'non-profit organization',
  'energy company', 'environmental consulting firm'
];

const SAAS_TARGET_REGIONS = [
  // Top Canadian Regions & Cities
  'Toronto Ontario', 'Vancouver BC', 'Montreal Quebec', 'Calgary Alberta', 'Ottawa Ontario',
  'Edmonton Alberta', 'Mississauga Ontario', 'Winnipeg Manitoba', 'Halifax Nova Scotia', 'Victoria BC',
  'Quebec City', 'Hamilton Ontario', 'Kitchener Waterloo', 'London Ontario', 'Saskatoon Saskatchewan',
  
  // Top US States & Tech Hubs
  'California', 'Texas', 'New York', 'Florida', 'Illinois', 'Pennsylvania', 'Ohio', 'Georgia',
  'North Carolina', 'Michigan', 'New Jersey', 'Virginia', 'Washington', 'Arizona', 'Massachusetts',
  'San Francisco CA', 'Silicon Valley', 'Los Angeles CA', 'San Diego CA', 'Austin TX', 'Dallas TX',
  'Houston TX', 'New York City', 'Chicago IL', 'Miami FL', 'Atlanta GA', 'Seattle WA', 'Boston MA',
  'Denver CO', 'Washington DC', 'Phoenix AZ', 'Las Vegas NV', 'Salt Lake City UT', 'Raleigh NC'
];

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
];

const SKIP_DOMAINS = new Set([
  'google.com', 'duckduckgo.com', 'linkedin.com', 'facebook.com', 'twitter.com',
  'youtube.com', 'instagram.com', 'bing.com', 'yahoo.com', 'wikipedia.org',
  'reddit.com', 'pinterest.com', 'amazon.com', 'ebay.com', 'apple.com',
  'indeed.com', 'glassdoor.com', 'monster.com', 'craigslist.org',
  'goodfirms.co', 'sortlist.com', 'clutch.co', 'g2.com', 'capterra.com',
  'gartner.com', 'trustradius.com', 'softwareadvice.com',
  'gov.ca', 'gc.ca', 'canada.ca', 'gov.uk', 'gov.au',
]);

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function isSkipDomain(hostname) {
  const h = hostname.toLowerCase().replace(/^www\./, '');
  for (const skip of SKIP_DOMAINS) {
    if (h === skip || h.endsWith('.' + skip)) return true;
  }
  return false;
}

function nameFromWebsite(website) {
  try {
    const host = new URL(website).hostname.replace(/^www\./i, '');
    const root = host.split('.')[0];
    return root.charAt(0).toUpperCase() + root.slice(1);
  } catch {
    return null;
  }
}

function idFromSeed(prefix, seed) {
  return `${prefix}-${Buffer.from(String(seed)).toString('hex').slice(0, 14)}`;
}

/**
 * SaaS Lead Finder — Main discovery function
 * Searches DuckDuckGo for IT/security companies, scrapes their websites for emails,
 * verifies them, and inserts into the database for the SaaS engine to pick up.
 */
export async function discoverSaaSLeads({ db, config, logger, maxQueries = 100, forceRun = false }) {
  const log = (level, msg) => {
    if (logger) logger(`[SAAS-FINDER] [${level.toUpperCase()}] ${msg}`);
    else console.log(`[SAAS-FINDER] [${level.toUpperCase()}] ${msg}`);
  };

  // Rate limiting: Only run once per 2 hours
  const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
  const statePath = path.join(dataDir, 'saas_finder_state.json');
  let state = { lastRun: 0, queryOffset: 0 };
  try {
    if (fs.existsSync(statePath)) {
      state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    }
  } catch {}

  const cooldownMs = 5 * 60 * 1000; // 5 mins
  if (!forceRun && Date.now() - (state.lastRun || 0) < cooldownMs) {
    log('info', 'Lead finder on cooldown. Skipping.');
    return { found: 0, verified: 0, skipped: true };
  }

  if (forceRun) {
    log('info', 'Queue empty — bypassing lead-finder cooldown.');
  }

  log('info', 'Starting CyberSec Pro lead discovery via Startpage...');

  // Build search queries: query × region combinations, shuffled
  const allQueries = [];
  for (const q of SAAS_SEARCH_QUERIES) {
    for (const r of SAAS_TARGET_REGIONS) {
      allQueries.push({ query: q, region: r });
    }
  }

  // Fix: Slice first to ensure we rotate through all segments deterministically, then shuffle the batch
  const startIndex = state.queryOffset || 0;
  const endIndex = Math.min(startIndex + maxQueries, allQueries.length);
  let batch = allQueries.slice(startIndex, endIndex);
  
  if (batch.length < maxQueries && startIndex > 0) {
    batch = batch.concat(allQueries.slice(0, maxQueries - batch.length));
  }
  batch = shuffleArray(batch);

  const checkCompanyStmt = db.prepare('SELECT 1 FROM companies WHERE LOWER(company_name) = ? LIMIT 1');
  const checkEmailStmt = db.prepare('SELECT 1 FROM email_records WHERE LOWER(email) = ? LIMIT 1');

  let totalFound = 0;
  let totalVerified = 0;

  for (const { query, region } of batch) {
    try {
      const searchTerm = encodeURIComponent(`"${query}" "${region}" contact email`);
      
      // Rotate search engines to maximize discovery and avoid blocks
      const engines = [
        `https://www.startpage.com/do/dsearch?query=${searchTerm}&cat=web`,
        `https://html.duckduckgo.com/html/?q=${searchTerm}&kl=us-en`,
        `https://www.bing.com/search?q=${searchTerm}`
      ];
      const searchUrl = engines[Math.floor(Math.random() * engines.length)];

      log('info', `Searching: "${query}" in ${region}`);

      const { RateLimiter, UserAgentRotator, fetchWithFallback } = await import('./scraper.js');
      const rateLimiter = new RateLimiter(2000);
      const uaRotator = new UserAgentRotator(config.user_agents || [randomUA()]);

      const { data: rawHtml, source: _source } = await fetchWithFallback(searchUrl, config, uaRotator, rateLimiter, (evt) => {
        if (evt.level === 'error') log('warn', evt.message);
      });

      const html = (typeof rawHtml === 'string') ? rawHtml : '';

      // Extract ALL URLs from the page (Startpage embeds real URLs directly)
      const allUrls = html.match(/https?:\/\/[^\s"'<>]+/g) || [];
      const candidateUrls = new Set();

      for (const rawUrl of allUrls) {
        try {
          // Clean trailing punctuation
          const cleanUrl = rawUrl.replace(/[,;)}\]]+$/, '');
          const parsed = new URL(cleanUrl);
          const host = parsed.hostname.toLowerCase();

          // Skip search engines, social media, directories
          if (isSkipDomain(host)) continue;
          if (host.includes('startpage') || host.includes('ixquick')) continue;
          if (host.includes('mastodon') || host.includes('system1.com')) continue;

          candidateUrls.add(parsed.origin);
        } catch {}
      }

      log('info', `Found ${candidateUrls.size} candidate company URLs`);

      // Scrape each company website for emails (parallel batches of 3)
      const urlArr = [...candidateUrls];
      for (let i = 0; i < urlArr.length; i += 3) {
        const batch = urlArr.slice(i, i + 3);
        await Promise.allSettled(batch.map(async (siteUrl) => {
          try {
            const companyName = nameFromWebsite(siteUrl);
            if (!companyName || companyName.length < 3) return;

            if (checkCompanyStmt.get(companyName.toLowerCase())) return;

            const scrapeResult = await scrapeWebsiteForEmails(siteUrl, log);
            const siteEmails = scrapeResult.emails;
            const linkedinUrl = scrapeResult.linkedinUrl;
            if (siteEmails.length === 0) return;

            const companyId = idFromSeed('SAAS-FIND', `${companyName}-${siteUrl}`);
            try {
              insertCompany(db, {
                business_id: companyId,
                company_name: companyName,
                website: siteUrl,
              });
            } catch {}

            for (const email of siteEmails) {
              if (checkEmailStmt.get(email.toLowerCase())) continue;

              const verification = await verifyEmail(email, { ...config, allowGeneric: true });
              if (!verification.valid) {
                log('debug', `[REJECTED] ${email} (${verification.reason})`);
                continue;
              }

              const emailType = classifyEmail(email);

              insertEmailRecord(db, {
                company_name: companyName,
                business_id: companyId,
                website: siteUrl,
                email: email,
                email_type: emailType === 'general' ? 'management' : emailType,
                source: 'saas_finder',
                verified: 1,
                verification_score: verification.score || 0.6,
                linkedin_url: linkedinUrl,
              });

              totalVerified++;
              log('info', `✅ [NEW LEAD] ${email} @ ${companyName} (${emailType})`);
            }

            totalFound++;
            await sleep(1500);
          } catch (err) {
            log('debug', `Scrape error for ${siteUrl}: ${err.message}`);
          }
        }));
      }

      await sleep(3000); // Polite delay between search queries
    } catch (err) {
      log('warn', `Search error: ${err.message}`);
      await sleep(3000);
    }
  }

  // Save state
  state.lastRun = Date.now();
  state.queryOffset = ((state.queryOffset || 0) + maxQueries) % allQueries.length;
  fs.writeFileSync(statePath, JSON.stringify(state));

  log('info', `Discovery complete. ${totalFound} companies found, ${totalVerified} verified emails added.`);
  return { found: totalFound, verified: totalVerified };
}

/**
 * Scrape a single website for contact emails.
 * Checks main page + /contact, /about pages.
 */
async function scrapeWebsiteForEmails(baseUrl, log) {
  const emails = new Set();
  let linkedinUrl = null;
  const pagesToCheck = [
    baseUrl,
    baseUrl + '/contact',
    baseUrl + '/contact-us',
    baseUrl + '/about',
    baseUrl + '/about-us',
  ];

  for (const pageUrl of pagesToCheck) {
    try {
      const resp = await axios.get(pageUrl, {
        headers: { 'User-Agent': randomUA() },
        timeout: 10000,
        maxRedirects: 3,
        validateStatus: (s) => s < 400,
      });

      const html = resp.data || '';
      const found = extractEmails(html);
      
      if (!linkedinUrl) {
         const match = html.match(/https:\/\/(www\.)?linkedin\.com\/company\/[a-zA-Z0-9-]+/i);
         if (match) linkedinUrl = match[0];
      }
      
      const cleanHost = new URL(baseUrl).hostname.replace(/^www\./i, '');
      const hostParts = cleanHost.split('.');
      const mainName = hostParts.length >= 2 ? hostParts[hostParts.length - 2] : hostParts[0];
      const genericProviders = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com'];

      for (const e of found) {
        const lower = e.toLowerCase();
        const emailDomain = lower.split('@')[1];
        
        // Enforce that email domain shares roots with the scraped website or is a generic provider
        if (emailDomain.includes(mainName) || genericProviders.includes(emailDomain) || cleanHost.includes(emailDomain.split('.')[0])) {
          emails.add(lower);
        } else {
          log('debug', `[CROSS-DOMAIN REJECTED] ${lower} from ${cleanHost}`);
        }
      }
    } catch {
      // Silently skip unreachable pages
    }
    
    // Early exit if we found what we need on this page to save bandwidth
    if (emails.size > 0 && linkedinUrl) {
      break;
    }
  }

  return { emails: [...emails], linkedinUrl };
}
