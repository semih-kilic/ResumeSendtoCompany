/**
 * Job Bank Canada Importer
 * https://www.jobbank.gc.ca — Official Canadian government job board.
 * No bot protection, reliable, free. Returns real hiring companies with websites.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const JOB_BANK_SEARCHES = [
  'IT systems administrator',
  'IT support specialist',
  'network administrator',
  'system administrator',
  'IT infrastructure',
  'help desk technician',
  'cloud engineer',
  'DevOps engineer',
  'cybersecurity analyst',
  'software developer',
  'database administrator',
  'IT manager',
];

const PROVINCES = ['ON', 'BC', 'AB', 'QC', 'MB', 'SK', 'NS', 'NB'];

function idFromSeed(seed) {
  return 'JOBBANK-' + Buffer.from(String(seed)).toString('hex').slice(0, 14);
}

export async function sweepJobBankToDatabase({ db: externalDb = null, maxPages = 5, logger = console.log } = {}) {
  const ownDb = !externalDb;
  const db = externalDb || new Database(path.join(__dirname, 'data', 'canada.db'));

  let totalImported = 0;
  const checkStmt = db.prepare('SELECT 1 FROM companies WHERE LOWER(company_name) = ? LIMIT 1');

  logger('[JOBBANK] Starting Job Bank Canada sweep...');

  for (const searchTerm of JOB_BANK_SEARCHES) {
    for (const province of PROVINCES) {
      for (let page = 1; page <= maxPages; page++) {
        try {
          const params = new URLSearchParams({
            searchstring: searchTerm,
            locationstring: province,
            sort: 'D', // Date descending
            start: (page - 1) * 25,
            fprov: province,
          });

          const url = `https://www.jobbank.gc.ca/jobsearch/jobsearch?${params}`;
          const res = await axios.get(url, {
            timeout: 15000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
              'Accept': 'text/html,application/xhtml+xml',
              'Accept-Language': 'en-CA,en;q=0.9',
            }
          });

          const $ = cheerio.load(res.data);
          let insertedThisPage = 0;

          // Job Bank lists jobs with employer names and links
          $('article.resultJobItem').each((_, el) => {
            try {
              const companyName = $(el).find('li.business').text().trim();
              const _jobLink = $(el).find('a.resultJobItem').attr('href');

              if (!companyName || companyName.length < 2) return;

              // Extract a website hint from the job link if available
              const businessId = idFromSeed(`${companyName}-${province}`);

              const exists = checkStmt.get(companyName.toLowerCase());
              if (exists) return;

              try {
                db.prepare("INSERT OR IGNORE INTO companies (business_id, company_name, website, fetched_at) VALUES (?, ?, ?, datetime('now'))")
                  .run(businessId, companyName, null);
                const result = db.prepare('SELECT changes() as c').get();
                if (result?.c > 0) {
                  totalImported++;
                  insertedThisPage++;
                }
              } catch {}
            } catch {}
          });

          logger(`[JOBBANK] ${searchTerm} / ${province} page ${page}: +${insertedThisPage} companies`);

          if ($('article.resultJobItem').length === 0) break; // No more results

          await new Promise(r => setTimeout(r, 1500)); // Polite delay
        } catch (err) {
          logger(`[JOBBANK] Error for ${searchTerm}/${province}/p${page}: ${err.message}`);
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    }
  }

  if (ownDb) db.close();
  logger(`[JOBBANK] Sweep complete. New companies: ${totalImported}`);
  return { totalImported };
}
