import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDbPath = path.join(__dirname, 'data', 'canada.db');

function defaultLogger(msg) {
  console.log(msg);
}

// BBB requires a city+province location; country-only queries return no results.
const LOCATIONS = [
  'Toronto%2C%20ON', 'Vancouver%2C%20BC', 'Calgary%2C%20AB', 'Ottawa%2C%20ON',
  'Montreal%2C%20QC', 'Edmonton%2C%20AB', 'Mississauga%2C%20ON', 'Winnipeg%2C%20MB',
  'Hamilton%2C%20ON', 'London%2C%20ON', 'Quebec%2C%20QC', 'Halifax%2C%20NS'
];
const TERMS = [
  'IT%20services', 'computer%20services', 'IT%20consulting',
  'network%20security', 'managed%20services', 'cloud%20services'
];

export async function sweepBBBToDatabase({
  db: externalDb = null,
  maxPages = 15,
  logger = defaultLogger
} = {}) {
  const ownDb = !externalDb;
  const db = externalDb || new Database(defaultDbPath);

  let browser;
  let totalImported = 0;
  let pagesScanned = 0;

  logger('[BBB] Starting Better Business Bureau Canada sweep...');

  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu',
        '--disable-blink-features=AutomationControlled', '--window-size=1366,768',
        '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check'
      ]
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-CA,en;q=0.9', 'Upgrade-Insecure-Requests': '1' });
    // Automation tespitini azalt
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = { runtime: {} };
    });

    for (let li = 0; li < LOCATIONS.length && pagesScanned < maxPages; li++) {
      const loc = LOCATIONS[li];
      for (let ti = 0; ti < TERMS.length && pagesScanned < maxPages; ti++) {
        const term = TERMS[ti];
        logger(`[BBB] ${decodeURIComponent(loc)} / ${decodeURIComponent(term)}`);

        // ilk 3 sayfayi tara (sayfalama test edildi: page=1..N calisiyor)
        const perLocPages = Math.min(3, maxPages - pagesScanned);
        for (let pageNum = 1; pageNum <= perLocPages; pageNum++) {
          pagesScanned++;
          const url = `https://www.bbb.org/search?find_loc=${loc}&find_text=${term}&page=${pageNum}`;
          logger(`[BBB] Fetching page ${pageNum}: ${url}`);
          try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
          } catch { /* navigasyon hatalarini atla */ }
          await new Promise((r) => setTimeout(r, 4000)); // sayfa icin bekle

          const companies = await page.evaluate(() => {
            const OUT = [];
            const seen = new Set();
            // BBB result cards: profil linkleri ve basliklar
            const links = Array.from(document.querySelectorAll('a[href*="/profile/"], h3 a, h4 a'));
            for (const a of links) {
              const name = (a.textContent || '').replace(/\s+/g, ' ').trim();
              if (name.length < 3 || name.length > 100) continue;
              const key = name.toLowerCase();
              if (seen.has(key)) continue;
              seen.add(key);

              let website = null;
              const link = a.getAttribute('href') || '';
              const isProfile = link.includes('/profile/');
              // card icinde ilk dis linki web sitesi olarak dene
              const parent = a.closest('div');
              if (parent) {
                const ext = Array.from(parent.querySelectorAll('a[href^="http"]'));
                for (const e of ext) {
                  const href = e.getAttribute('href') || '';
                  if (!href.includes('bbb.org') && /^https?:/i.test(href)) { website = href; break; }
                }
              }
              OUT.push({ name, website, isProfile });
            }
            return OUT;
          });

          // profile linkleriyle eslesen adlari tercih et
          const valid = companies.filter((c) => c.name && c.name.length >= 3);
          if (valid.length === 0) {
            logger('[BBB] No entries found (possibly Captcha). Stopping this term.');
            break; // bu terim/konum icin dur
          }

          let insertedThisPage = 0;
          for (const { name, website } of valid) {
            const businessId = 'BBB-' + Buffer.from(name).toString('hex').slice(0, 16);
            try {
              const stmt = db.prepare('INSERT OR IGNORE INTO companies (business_id, company_name, website) VALUES (?, ?, ?)');
              const result = stmt.run(businessId, name, website || null);
              if (result.changes > 0) {
                totalImported++;
                insertedThisPage++;
              }
            } catch {}
          }
          logger(`[BBB] Page ${pageNum} done. Found ${valid.length}, New to DB: ${insertedThisPage}`);
          await new Promise((r) => setTimeout(r, 3000)); // sayfalar arasi bekleme
        }
      }
    }
  } catch (err) {
    logger(`[BBB] Fatal error during sweep: ${err.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (ownDb) db.close();
  }

  logger(`[BBB] Sweep complete. New companies imported: ${totalImported}`);
  return { totalImported, pagesProcessed: pagesScanned };
}

async function runStandalone() {
  try {
    await sweepBBBToDatabase();
  } catch (err) {
    console.error('[BBB] Fatal error:', err.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStandalone();
}