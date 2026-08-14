/**
 * Job Bank Canada Importer
 * https://www.jobbank.gc.ca — Canadian government job board.
 * NOTE: Job Bank is often rate-limited/500 on bursts; search terms must be short
 * (long phrases return 0 results). DOM has changed over time, so we use tolerant selectors.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Kısa, gerçek sonuç veren mesleki terimler (uzun cümleler JobBank'ta 0 sonuç döner)
const JOB_BANK_SEARCHES = [
  'IT', 'system administrator', 'IT support', 'network administrator', 'help desk',
  'technical support', 'desktop support', 'cloud engineer', 'DevOps', 'cybersecurity',
  'software developer', 'data analyst', 'network technician', 'sysadmin',
];

const PROVINCES = ['ON', 'BC', 'AB', 'QC', 'MB', 'SK', 'NS', 'NB'];

function idFromSeed(seed) {
  return 'JOBBANK-' + Buffer.from(String(seed)).toString('hex').slice(0, 14);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const JOB_SELECTORS = [
  'article.resultJobItem', '[class*="resultJobItem"]', '.job-item',
  '.search-noc article', 'article', '.resultJobItem', '.article',
];

function extractCompanyName($, el) {
  const q = (sel) => $(el).find(sel).first().text().replace(/\s+/g, ' ').trim();
  return (
    q('li.business') ||
    q('.business') ||
    q('[itemprop="hiringOrganization"]') ||
    q('.company-name') ||
    q('h3') ||
    q('h4') ||
    (el.find('[itemprop="name"]').first().text().trim())
  );
}

export async function sweepJobBankToDatabase({
  db: externalDb = null, maxPages = 2, logger = console.log,
} = {}) {
  const ownDb = !externalDb;
  const db = externalDb || new Database(path.join(__dirname, 'data', 'canada.db'));

  let totalImported = 0;
  const checkStmt = db.prepare('SELECT 1 FROM companies WHERE LOWER(company_name) = ? LIMIT 1');

  logger('[JOBBANK] Starting Job Bank Canada sweep...');

  for (const searchTerm of JOB_BANK_SEARCHES) {
    for (const province of PROVINCES) {
      for (let page = 1; page <= maxPages; page++) {
        const params = new URLSearchParams({
          searchstring: searchTerm,
          locationstring: province,
          fprov: province,
          start: (page - 1) * 25,
        });
        const url = `https://www.jobbank.gc.ca/jobsearch/jobsearch?${params}`;

        try {
          const res = await axios.get(url, {
            timeout: 25000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0',
              'Accept-Language': 'en-CA,en;q=0.9',
              'Accept': 'text/html,application/xhtml+xml',
            },
          });

          const $ = cheerio.load(res.data);
          const bodyText = $('body').text();

          // Job Bank bazen "0 results" döndürür (uzun terimler, cografi eslesme yok) -> hizli skip
          if (/0\s+results/i.test(bodyText) || bodyText.includes('could not find any results')) {
            logger(`[JOBBANK] ${searchTerm} / ${province} p${page}: 0 results. Skipping comboc.`);
            break;
          }

          // Tolerant DOM: hangi selector ise yararsa sirketleri topla
          let jobEls = [];
          for (const sel of JOB_SELECTORS) {
            jobEls = $(sel).toArray();
            if (jobEls.length) break;
          }
          // son care: h2 basliklari (is basliklari) iceren kartlar
          if (jobEls.length === 0) jobEls = $('section, div').filter((_, el) => $(el).find('h2 a, h3 a').length > 0).toArray();

          let insertedThisPage = 0;
          for (const elRaw of jobEls) {
            try {
              const el = $(elRaw);
              let companyName = extractCompanyName($, el);
              if (!companyName || companyName.length < 2 || companyName.length > 120) continue;
              companyName = companyName.replace(/\s+/g, ' ').trim();

              if (checkStmt.get(companyName.toLowerCase())) continue;

              const businessId = idFromSeed(`${companyName}-${province}`);
              try {
                db.prepare("INSERT OR IGNORE INTO companies (business_id, company_name, website, fetched_at) VALUES (?, ?, ?, datetime('now'))")
                  .run(businessId, companyName, null);
                const r = db.prepare('SELECT changes() as c').get();
                if (r?.c > 0) { totalImported++; insertedThisPage++; }
              } catch {}
            } catch {}
          }

          logger(`[JOBBANK] ${searchTerm} / ${province} p${page}: +${insertedThisPage} companies (found ${jobEls.length})`);
          await sleep(3000); // nazik bekleme (rate-limit)

          // Sonuc yoksa bu terim/eyalette dur
          if (jobEls.length === 0) break;
        } catch (err) {
          // 500/timeout/rate-limit -> uzun bekle ve bu kombinasyonu atla
          logger(`[JOBBANK] ${searchTerm}/${province}/p${page} error: ${err.message?.split('\n')[0]}. Backoff.`);
          await sleep(12000);
          break; // bu provinsteki bu terimde uzun sure takilma; sonraki kombinasyona gec
        }
      }
    }
  }

  if (ownDb) db.close();
  logger(`[JOBBANK] Sweep complete. New companies: ${totalImported}`);
  return { totalImported };
}