const Database = require('better-sqlite3');
const db = new Database('./data/canada.db');

console.log('\n=== COMPANIES ADDED LAST 7 DAYS ===');
const recent = db.prepare("SELECT DATE(fetched_at) as day, COUNT(*) as cnt FROM companies WHERE fetched_at >= datetime('now','-7 days') GROUP BY DATE(fetched_at) ORDER BY day DESC").all();
recent.forEach(r => console.log(r.day, ':', r.cnt, 'companies'));

console.log('\n=== EMAILS FOUND LAST 7 DAYS ===');
const recentEmails = db.prepare("SELECT DATE(found_date) as day, COUNT(*) as cnt FROM email_records WHERE found_date >= datetime('now','-7 days') GROUP BY DATE(found_date) ORDER BY day DESC").all();
recentEmails.forEach(r => console.log(r.day, ':', r.cnt, 'emails'));

console.log('\n=== COMPANIES WITH NO EMAILS (unprocessed) ===');
const noEmail = db.prepare('SELECT COUNT(*) as cnt FROM companies WHERE business_id NOT IN (SELECT DISTINCT business_id FROM email_records)').get();
console.log(noEmail.cnt, 'companies have no email records');

console.log('\n=== WEBSITE COVERAGE ===');
const withSite = db.prepare("SELECT COUNT(*) as cnt FROM companies WHERE website IS NOT NULL").get();
const withoutSite = db.prepare("SELECT COUNT(*) as cnt FROM companies WHERE website IS NULL").get();
console.log('With website:', withSite.cnt);
console.log('Without website:', withoutSite.cnt);

console.log('\n=== COMPANY SOURCE DISTRIBUTION ===');
const sources = db.prepare("SELECT SUBSTR(business_id, 1, 8) as prefix, COUNT(*) as cnt FROM companies GROUP BY SUBSTR(business_id, 1, 8) ORDER BY cnt DESC LIMIT 10").all();
sources.forEach(r => console.log(r.prefix, ':', r.cnt));

console.log('\n=== EMAIL VERIFICATION BREAKDOWN ===');
const verif = db.prepare("SELECT verified, COUNT(*) as cnt FROM email_records GROUP BY verified").all();
verif.forEach(r => console.log(r.verified ? 'Verified' : 'Unverified', ':', r.cnt));

console.log('\n=== PREMIUM_SYNC STATE ===');
const fs = require('fs');
const path = require('path');
const syncPath = path.join('./data/premium_sync.json');
if (fs.existsSync(syncPath)) {
  const sync = JSON.parse(fs.readFileSync(syncPath, 'utf8'));
  const ageMins = Math.round((Date.now() - sync.lastTs) / 60000);
  console.log('Last premium sync:', ageMins, 'minutes ago');
  console.log('Total imported:', sync.importedTotal);
} else {
  console.log('No premium_sync.json found');
}

console.log('\n=== DISCOVERY STATE ===');
const discPath = path.join('./data/discovery_active.json');
if (fs.existsSync(discPath)) {
  const disc = JSON.parse(fs.readFileSync(discPath, 'utf8'));
  console.log('Discovery active:', disc.active);
  console.log('Since:', disc.ts);
} else {
  console.log('No discovery_active.json found');
}

console.log('\n=== DUPLICATE BUSINESS IDs (saturation indicator) ===');
const total = db.prepare('SELECT COUNT(*) as cnt FROM companies').get();
const unique = db.prepare('SELECT COUNT(DISTINCT LOWER(company_name)) as cnt FROM companies').get();
console.log('Total entries:', total.cnt);
console.log('Unique company names:', unique.cnt);
console.log('Duplicates:', total.cnt - unique.cnt);

db.close();
