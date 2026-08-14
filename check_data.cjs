const Database = require('better-sqlite3');
const db = new Database('data/canada.db');
const total = db.prepare("SELECT COUNT(*) as c FROM companies").get().c;
console.log('Total companies:', total);

// Sample some companies
const samples = db.prepare("SELECT * FROM companies LIMIT 5").all();
samples.forEach(c => console.log(`  ${c.company_name} | ${c.website}`));

// Email records sources
const sources = db.prepare("SELECT source, COUNT(*) as c FROM email_records GROUP BY source ORDER BY c DESC").all();
console.log('\nEmail record sources:');
sources.forEach(s => console.log(`  ${s.source}: ${s.c}`));
