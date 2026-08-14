import Database from 'better-sqlite3';

const db = new Database('./data/canada.db');

console.log('=== DATABASE HEALTH CHECK ===');
console.log('Companies:', db.prepare('SELECT COUNT(*) as c FROM companies').get().c);
console.log('Emails:', db.prepare('SELECT COUNT(*) as c FROM email_records').get().c);
console.log('Verified:', db.prepare('SELECT COUNT(*) as c FROM email_records WHERE verified=1').get().c);
console.log('Sent (normal):', db.prepare('SELECT COUNT(*) as c FROM send_log').get().c);
console.log('Sent (saas):', db.prepare('SELECT COUNT(*) as c FROM send_log_saas').get().c);

console.log('\n--- Last 10 discoveries ---');
const recent = db.prepare('SELECT company_name, email, source, found_date FROM email_records ORDER BY found_date DESC LIMIT 10').all();
recent.forEach(r => console.log(`  ${r.found_date} | ${r.company_name} | ${r.email} | ${r.source}`));

console.log('\n--- Last 10 SaaS sends ---');
const sends = db.prepare('SELECT email, company_name, sent_at FROM send_log_saas ORDER BY sent_at DESC LIMIT 10').all();
sends.forEach(s => console.log(`  ${s.sent_at} | ${s.company_name} | ${s.email}`));

console.log('\n--- Email sources ---');
db.prepare('SELECT source, COUNT(*) as c FROM email_records GROUP BY source').all().forEach(r => console.log(`  ${r.source}: ${r.c}`));

console.log('\n--- Emails by day (last 7 days) ---');
db.prepare("SELECT DATE(found_date) as day, COUNT(*) as c FROM email_records WHERE found_date >= datetime('now', '-7 days') GROUP BY DATE(found_date) ORDER BY day").all().forEach(r => console.log(`  ${r.day}: ${r.c}`));

console.log('\n--- SaaS sends by day (last 7 days) ---');
db.prepare("SELECT DATE(sent_at) as day, COUNT(*) as c FROM send_log_saas WHERE sent_at >= datetime('now', '-7 days') GROUP BY DATE(sent_at) ORDER BY day").all().forEach(r => console.log(`  ${r.day}: ${r.c}`));

console.log('\n--- Unsent verified emails ---');
const unsent = db.prepare(`
  SELECT COUNT(*) as c FROM email_records er
  WHERE er.verified = 1 AND er.excluded = 0
  AND er.email NOT IN (SELECT email FROM send_log)
  AND er.email NOT IN (SELECT email FROM send_log_saas)
`).get();
console.log('  Unsent verified emails:', unsent.c);

db.close();
