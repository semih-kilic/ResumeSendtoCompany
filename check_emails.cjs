const Database = require('better-sqlite3');
const db = new Database('data/canada.db');
const total = db.prepare("SELECT COUNT(*) as c FROM email_records").get().c;
const recent = db.prepare("SELECT * FROM email_records ORDER BY rowid DESC LIMIT 5").all();
console.log('Total email records:', total);
console.log('\nRecent emails:');
recent.forEach(e => console.log(`  ${e.email} | ${e.company_name} | ${e.source}`));
