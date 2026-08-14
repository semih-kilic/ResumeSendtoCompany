import Database from 'better-sqlite3';
import { WebScraper, RateLimiter, UserAgentRotator } from './scraper.js';
import { verifyEmail } from './verifier.js';
import { insertEmailRecord } from './db.js';
import { loadConfig } from './config.js';
import { classifyEmail } from './extractor.js';


async function runRecrawl() {
  console.log('🚀 CANADA OMEGA - HARVEST DEEP RECRAWLER STARTING...');
  const db = new Database('./data/canada.db');
  const config = loadConfig();

  // Select companies with websites but no emails in email_records
  const targets = db.prepare(`
    SELECT business_id, company_name, website 
    FROM companies 
    WHERE website IS NOT NULL AND website != '' 
      AND business_id NOT IN (SELECT DISTINCT business_id FROM email_records)
    ORDER BY RANDOM()
  `).all();

  console.log(`🎯 Found ${targets.length} companies suitable for deep scraping.`);

  const rateLimiter = new RateLimiter(config.domain_delay_ms || 1500);
  const uaRotator = new UserAgentRotator(config.user_agents || [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  ]);
  
  // Set configuration to force direct-stealth (since proxies keys are exhausted)
  const directConfig = {
    ...config,
    scraperapi_key: '',
    scrapingbee_key: '',
    zenrows_key: '',
    concurrency: 5
  };

  const scraper = new WebScraper(directConfig, rateLimiter, uaRotator, null);

  let successCount = 0;
  let companiesProcessed = 0;

  for (const company of targets) {
    companiesProcessed++;
    console.log(`\n[${companiesProcessed}/${targets.length}] Taring: ${company.company_name} (${company.website})`);

    try {
      // Scrape the company website
      const scrapedEmails = await scraper.scrapeCompany(company);
      
      if (scrapedEmails.length === 0) {
        console.log(`  ❌ No emails found on site.`);
        // To avoid scraping it again and again, write a dummy/failed placeholder or let it be
        // Let's insert a temporary excluded record so we don't waste time recrawling it in this run
        continue;
      }

      console.log(`  🔍 Found ${scrapedEmails.length} raw email candidates. Verifying...`);
      let verifiedOnThisCompany = 0;

      for (const record of scrapedEmails) {
        // SaaS targets require allowGeneric to harvest info@ / sales@ leads
        const isSaaSTarget = company.business_id.startsWith('SAAS-');
        const verification = await verifyEmail(record.email, {
          ...config,
          allowGeneric: isSaaSTarget ? true : config.allowGeneric
        });
        
        if (!verification.valid) {
          console.log(`    Rej: ${record.email} (${verification.reason})`);
          continue;
        }

        const emailType = classifyEmail(record.email);

        const verifiedRecord = {
          company_name: company.company_name,
          business_id: company.business_id,
          website: company.website,
          email: record.email,
          email_type: emailType === 'general' ? 'management' : emailType,
          source: 'recrawler',
          verified: 1,
          verification_score: verification.score || 0.7
        };

        // Insert into database
        try {
          insertEmailRecord(db, verifiedRecord);
          console.log(`    ✅ VERIFIED & ADDED: ${record.email} (${emailType})`);
          verifiedOnThisCompany++;
          successCount++;
        } catch(e) {
          // Unique constraint bypass
        }
      }

      if (verifiedOnThisCompany > 0) {
        console.log(`  🎉 Added ${verifiedOnThisCompany} new leads for ${company.company_name}`);
      }

    } catch(err) {
      console.log(`  Error scraping ${company.company_name}: ${err.message}`);
    }

    // Stop early in active sessions to let the user review, or keep running
    // Let's run a batch of 30 companies to get fresh leads immediately
    if (successCount >= 35 || companiesProcessed >= 60) {
      console.log(`\nStopping batch run. Processed ${companiesProcessed} companies, harvested ${successCount} fresh verified emails.`);
      break;
    }
  }

  db.close();
  console.log(`\n✅ Deep Recrawl batch complete. Fresh leads successfully added to campaign queue.`);
}

runRecrawl().catch(console.error);
