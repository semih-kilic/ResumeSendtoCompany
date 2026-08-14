import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDbPath = path.join(__dirname, 'data', 'canada.db');

function defaultLogger(msg) {
  console.log(msg);
}

// 411.ca business directory: /business-directory/on/<city>/<category>[/pN]
const TARGETS = [
  { city: 'mississauga', category: 'it-services' },
  { city: 'toronto', category: 'it-services' },
  { city: 'vancouver', category: 'it-services' },
  { city: 'calgary', category: 'it-services' },
  { city: 'ottawa', category: 'it-services' },
  { city: 'mississauga', category: 'computer-services' },
  { city: 'toronto', category: 'computer-services' },
  { city: 'vancouver', category: 'computer-services' },
  { city: 'mississauga', category: 'network-security' },
  { city: 'toronto', category: 'network-security' },
  { city: 'mississauga', category: 'managed-services' },
  { city: 'toronto', category: 'managed-services' },
  { city: 'vancouver', category: 'managed-services' },
  { city: 'toronto', category: 'software' },
  { city: 'mississauga', category: 'software' },
  { city: 'toronto', category: 'web-design' },
  { city: 'mississauga', category: 'web-design' },
  { city: 'mississauga', category: 'computer-repair' },
  { city: 'toronto', category: 'it-consultants' },
  { city: 'mississauga', category: 'it-consultants' },
  { city: 'ottawa', category: 'it-consultants' },
];

export async function sweep411ToDatabase({
  db: externalDb = null,
  maxPages = 8,
  logger = defaultLogger
} = {}) {
  const ownDb = !externalDb;
  const db = externalDb || new Database(defaultDbPath);

  let browser;
  let totalImported = 0;
  let pagesScanned = 0;

  logger('[411] Starting 411.ca directory sweep...');

  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-blink-features=AutomationControlled', '--window-size=1366,768', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-CA,en;q=0.9' });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = { runtime: {} };
    });

    // Sayfa icinden sirket listesini cikaran yardimci
    const scrapeFn = () => {
      const OUT = [];
      const seen = new Set();
      const links = Array.from(document.querySelectorAll('a[href*="/business/profile/"]'));
      for (const a of links) {
        const txt = (a.textContent || '').replace(/\s+/g, ' ').trim();
        if (!txt || txt.length < 3) continue;
        const name = txt.split(/\s{2,}|—/, 1)[0].trim();
        if (name.length < 2 || name.length > 90) continue;
        if (/\d{4}[A-Za-z]?$/.test(name) && /(st|ave|rd|blvd|hwy|e|w|n|s)\b/i.test(name)) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        let website = null;
        const parent = a.closest('div, li, article');
        if (parent) {
          const ext = Array.from(parent.querySelectorAll('a[href^="http"]'));
          for (const e of ext) {
            const href = e.getAttribute('href') || '';
            if (!href.includes('411.ca') && !href.includes('facebook')) { website = href; break; }
          }
        }
        OUT.push({ name, website });
      }
      return OUT;
    };

    for (const t of TARGETS) {
      let p = 1;
      while (p <= maxPages) {
        const pageUrl = p === 1
          ? `https://411.ca/business-directory/on/${t.city}/${t.category}`
          : `https://411.ca/business-directory/on/${t.city}/${t.category}/p${p}`;
        logger(`[411] ${t.city} / ${t.category} / page ${p}`);
        pagesScanned++;
        try {
          await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        } catch {}
        await new Promise((r) => setTimeout(r, 4000));

        let companies = [];
        // detached-frame yarisina karsi korumali okuma: bozuk frame'de sayfayi tekrar yukle
        for (let attempt = 0; attempt < 2 && companies.length === 0; attempt++) {
          try {
            companies = await page.evaluate(scrapeFn);
          } catch (err) {
            if (attempt === 0) {
              logger('[411] Frame dispose, reloading ' + pageUrl);
              try { await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }); } catch {}
              await new Promise((r) => setTimeout(r, 3000));
            } else {
              logger('[411] Skipping ' + pageUrl + ' (frame error)');
            }
          }
        }

        if (companies.length === 0) {
          logger('[411] No entries on this page. Stopping this target.');
          break;
        }

        let insertedThisPage = 0;
        for (const { name, website } of companies) {
          const businessId = '411CA-' + Buffer.from(name).toString('hex').slice(0, 16);
          try {
            const stmt = db.prepare('INSERT OR IGNORE INTO companies (business_id, company_name, website) VALUES (?, ?, ?)');
            const result = stmt.run(businessId, name, website || null);
            if (result.changes > 0) { totalImported++; insertedThisPage++; }
          } catch {}
        }
        logger(`[411] Page ${p}: Found ${companies.length}, New to DB: ${insertedThisPage}`);
        p++;
        await new Promise((r) => setTimeout(r, 2500));
      }
    }
  } catch (err) {
    logger(`[411] Fatal error during sweep: ${err.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (ownDb) db.close();
  }

  logger(`[411] Sweep complete. New companies imported: ${totalImported}`);
  return { totalImported, pagesProcessed: pagesScanned };
}

async function runStandalone() {
  try {
    await sweep411ToDatabase();
  } catch (err) {
    console.error('[411] Fatal error:', err.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStandalone();
}