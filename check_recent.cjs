const Database = require('better-sqlite3');
const db = new Database('data/canada.db');
const total = db.prepare("SELECT COUNT(*) as c FROM companies").get().c;
const recent = db.prepare("SELECT * FROM companies ORDER BY rowid DESC LIMIT 10").all();
console.log('Total companies:', total);
console.log('\nRecent companies:');
recent.forEach(c => console.log(`  ${c.company_name} | ${c.website || 'no website'}`));
