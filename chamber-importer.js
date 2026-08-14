import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDbPath = path.join(__dirname, 'data', 'canada.db');

function defaultLogger(msg) {
  console.log(msg);
}

export async function sweepChamberToDatabase({
  db: externalDb = null,
  maxPages = 50,
  logger = defaultLogger
} = {}) {
  const ownDb = !externalDb;
  const db = externalDb || new Database(defaultDbPath);

  let browser;
  let totalImported = 0;
  let pageNum = 1;

  logger('[CHAMBER] Starting Canadian Chamber directory sweep...');

  try {
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.goto('https://chamber.ca/membership/business-member-directory/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout?.(2500);

    while (true) {
      logger(`[CHAMBER] Processing page ${pageNum}...`);
      await page.waitForSelector('main, body', { timeout: 15000 }).catch(() => null);

      const companies = await page.evaluate(() => {
        const SOCIAL = ['linkedin.com', 'twitter.com', 'facebook.com', 'instagram.com', 'youtube.com'];
        const BAD_TEXT = ['visibility', 'connection', 'advocacy', 'membership', 'directory', 'cookies', 'accept'];
        const OUT = [];
        const seen = new Set();

        const safeName = (txt) => {
          if (!txt) return null;
          const value = txt.replace(/\s+/g, ' ').trim();
          if (value.length < 2 || value.length > 120) return null;
          const lower = value.toLowerCase();
          if (BAD_TEXT.some((x) => lower.includes(x))) return null;
          return value;
        };

        // Strategy A: traditional card headings
        const headingEls = Array.from(document.querySelectorAll('h2, h3, h4'));
        for (const heading of headingEls) {
          const name = safeName(heading.textContent || '');
          if (!name) continue;

          let website = null;
          let cursor = heading.closest('article, li, div') || heading.parentElement;
          if (cursor) {
            const links = Array.from(cursor.querySelectorAll('a[href^="http"]'));
            for (const a of links) {
              const href = a.getAttribute('href') || '';
              if (!href) continue;
              if (SOCIAL.some((s) => href.includes(s))) continue;
              if (href.includes('chamber.ca')) continue;
              website = href;
              break;
            }
          }

          const key = `${name.toLowerCase()}|${(website || '').toLowerCase()}`;
          if (!seen.has(key)) {
            seen.add(key);
            OUT.push({ name, website });
          }
        }

        // Strategy B: fallback from external links + nearby labels
        const extLinks = Array.from(document.querySelectorAll('a[href^="http"]'));
        for (const a of extLinks) {
          const href = a.getAttribute('href') || '';
          if (!href) continue;
          if (href.includes('chamber.ca')) continue;
          if (SOCIAL.some((s) => href.includes(s))) continue;
          const txt = safeName(a.textContent || '');
          if (!txt) continue;
          const key = `${txt.toLowerCase()}|${href.toLowerCase()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          OUT.push({ name: txt, website: href });
        }

        return OUT.slice(0, 500);
      });

      if (companies.length === 0) {
        logger('[CHAMBER] No entries found on current page. Stopping sweep.');
        break;
      }

      for (const { name, website } of companies) {
        const businessId = 'CHAMBER-' + Buffer.from(name).toString('hex').slice(0, 16);
        try {
          const stmt = db.prepare('INSERT OR IGNORE INTO companies (business_id, company_name, website) VALUES (?, ?, ?)');
          const result = stmt.run(businessId, name, website || null);
          if (result.changes > 0) totalImported++;
        } catch {
          // ignore single-row failures
        }
      }

      // Multiple next-page patterns
      const nextButton = await page.$('a.next.page-numbers, a[rel="next"], .pagination-next a, a[aria-label*="Next"]').catch(() => null);
      if (!nextButton || pageNum >= maxPages) break;
      pageNum++;
      await nextButton.click().catch(() => {});
      await new Promise((r) => setTimeout(r, 2800));
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (ownDb) db.close();
  }

  logger(`[CHAMBER] Sweep complete. New companies imported: ${totalImported}`);
  return { totalImported, pagesProcessed: pageNum };
}

async function runStandalone() {
  try {
    await sweepChamberToDatabase();
  } catch (err) {
    console.error('[CHAMBER] Fatal error:', err.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStandalone();
}
