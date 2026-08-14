import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDbPath = path.join(__dirname, 'data', 'canada.db');

function defaultLogger(msg) {
  console.log(msg);
}

export async function sweepBBBToDatabase({
  db: externalDb = null,
  maxPages = 15,
  logger = defaultLogger
} = {}) {
  const ownDb = !externalDb;
  const db = externalDb || new Database(defaultDbPath);

  let browser;
  let totalImported = 0;
  let pageNum = 1;

  logger('[BBB] Starting Better Business Bureau Canada sweep...');

  try {
    // BBB has anti-bot measures, basic evasion
    browser = await puppeteer.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    while (pageNum <= maxPages) {
      logger(`[BBB] Processing page ${pageNum}...`);
      
      // Targeting Canada location broadly, 'Company' text
      const url = `https://www.bbb.org/search?find_loc=Canada&find_text=Company&page=${pageNum}`;
      
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => null);
      await page.waitForTimeout?.(3000);

      const companies = await page.evaluate(() => {
        const OUT = [];
        const seen = new Set();
        
        // BBB uses highly structured result cards, often marked with h3 or special classes
        const links = Array.from(document.querySelectorAll('a.bds-h4, h3 a, h4 a, a[href*="/profile/"]'));
        
        for (const a of links) {
          let name = a.textContent || '';
          name = name.replace(/\s+/g, ' ').trim();
          if (name.length < 3 || name.length > 100) continue;
          
          let website = null;
          // Sometimes BBB lists the official website on the card itself
          let parent = a.closest('div');
          if (parent) {
             const extLinks = Array.from(parent.querySelectorAll('a[href^="http"]'));
             for (const ext of extLinks) {
                const href = ext.getAttribute('href');
                if (href && !href.includes('bbb.org')) {
                   website = href;
                   break;
                }
             }
          }

          const key = name.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            OUT.push({ name, website });
          }
        }
        return OUT;
      });

      if (companies.length === 0) {
        logger('[BBB] No entries found or blocked (Captcha). Stopping sweep.');
        break;
      }

      let insertedThisPage = 0;
      for (const { name, website } of companies) {
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

      logger(`[BBB] Page ${pageNum} done. Discovered ${companies.length}, New to DB: ${insertedThisPage}`);
      pageNum++;
      await new Promise((r) => setTimeout(r, 4000)); // Respectful delay
    }
  } catch (err) {
    logger(`[BBB] Fatal error during sweep: ${err.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (ownDb) db.close();
  }

  logger(`[BBB] Sweep complete. New companies imported: ${totalImported}`);
  return { totalImported, pagesProcessed: pageNum - 1 };
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
