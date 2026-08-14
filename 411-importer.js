import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDbPath = path.join(__dirname, 'data', 'canada.db');

function defaultLogger(msg) {
  console.log(msg);
}

export async function sweep411ToDatabase({
  db: externalDb = null,
  maxPages = 20,
  logger = defaultLogger
} = {}) {
  const ownDb = !externalDb;
  const db = externalDb || new Database(defaultDbPath);

  let browser;
  let totalImported = 0;
  let pageNum = 1;

  logger('[411] Starting 411.ca directory sweep...');

  try {
    // 411.ca is strict, we use basic evasion
    browser = await puppeteer.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    while (pageNum <= maxPages) {
      logger(`[411] Processing page ${pageNum}...`);
      
      // Broad generic search to catch all local businesses
      const url = `https://411.ca/search/?q=business&st=business&p=${pageNum}`;
      
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => null);
      await page.waitForTimeout?.(2500);

      const companies = await page.evaluate(() => {
        const OUT = [];
        const seen = new Set();
        
        // 411.ca typically lists businesses in div blocks
        const cards = Array.from(document.querySelectorAll('div[data-name], a[itemprop="url"], h2, h3'));
        
        for (const card of cards) {
          let name = card.getAttribute('data-name') || card.textContent || '';
          name = name.replace(/\s+/g, ' ').trim();
          if (name.length < 3 || name.length > 100) continue;
          
          let website = null;
          let parent = card.closest('div') || card.parentElement;
          if (parent) {
             const links = Array.from(parent.querySelectorAll('a[href^="http"]'));
             for (const a of links) {
                const href = a.getAttribute('href');
                if (href && !href.includes('411.ca') && !href.includes('facebook.com')) {
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
        logger('[411] No entries found or blocked. Stopping sweep.');
        break;
      }

      let insertedThisPage = 0;
      for (const { name, website } of companies) {
        const businessId = '411CA-' + Buffer.from(name).toString('hex').slice(0, 16);
        try {
          const stmt = db.prepare('INSERT OR IGNORE INTO companies (business_id, company_name, website) VALUES (?, ?, ?)');
          const result = stmt.run(businessId, name, website || null);
          if (result.changes > 0) {
            totalImported++;
            insertedThisPage++;
          }
        } catch {}
      }

      logger(`[411] Page ${pageNum} done. Discovered ${companies.length}, New to DB: ${insertedThisPage}`);
      pageNum++;
      await new Promise((r) => setTimeout(r, 3000)); // Be polite to 411 servers
    }
  } catch (err) {
    logger(`[411] Fatal error during sweep: ${err.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (ownDb) db.close();
  }

  logger(`[411] Sweep complete. New companies imported: ${totalImported}`);
  return { totalImported, pagesProcessed: pageNum - 1 };
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
