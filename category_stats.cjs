const Database = require('better-sqlite3');
const db = new Database('data/canada.db');

const total = db.prepare("SELECT COUNT(*) as c FROM companies").get().c;
const withWebsite = db.prepare("SELECT COUNT(*) as c FROM companies WHERE website IS NOT NULL AND website != ''").get().c;
const withEmail = db.prepare("SELECT COUNT(DISTINCT business_id) as c FROM email_records").get().c;

console.log('=== COMPANY STATS ===');
console.log('Total companies:', total);
console.log('With website:', withWebsite);
console.log('With email:', withEmail);

// Check email_records sources
const sources = db.prepare("SELECT source, COUNT(*) as c FROM email_records GROUP BY source ORDER BY c DESC").all();
console.log('\n=== EMAIL RECORDS BY SOURCE ===');
sources.forEach(s => console.log(`  ${s.source}: ${s.c}`));

// Check company sources (if we have a source column)
const cols = db.prepare("PRAGMA table_info(companies)").all();
console.log('\n=== COMPANIES TABLE COLUMNS ===');
cols.forEach(c => console.log(`  ${c.name}: ${c.type}`));

// Sample some companies
console.log('\n=== SAMPLE COMPANIES (last 20) ===');
const samples = db.prepare("SELECT * FROM companies ORDER BY rowid DESC LIMIT 20").all();
samples.forEach(c => console.log(`  ${c.company_name} | ${c.website || 'no website'}`));

// Count companies by website domain TLD
const tlds = db.prepare(`
  SELECT 
    CASE 
      WHEN website LIKE '%.ca' THEN '.ca'
      WHEN website LIKE '%.com' THEN '.com'
      WHEN website LIKE '%.org' THEN '.org'
      WHEN website LIKE '%.net' THEN '.net'
      WHEN website LIKE '%.io' THEN '.io'
      ELSE 'other'
    END as tld,
    COUNT(*) as c
  FROM companies 
  WHERE website IS NOT NULL AND website != ''
  GROUP BY tld
  ORDER BY c DESC
`).all();
console.log('\n=== COMPANIES BY TLD ===');
tlds.forEach(t => console.log(`  ${t.tld}: ${t.c}`));
