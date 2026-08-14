const Database = require('better-sqlite3');
const db = new Database('data/canada.db');

const totalEmails = db.prepare("SELECT COUNT(*) as c FROM email_records").get().c;
const withEmail = db.prepare("SELECT COUNT(*) as c FROM email_records WHERE email IS NOT NULL AND email != ''").get().c;
const mainSent = db.prepare("SELECT COUNT(*) as c FROM send_log").get().c;
const saasSent = db.prepare("SELECT COUNT(*) as c FROM send_log_saas").get().c;
const dlq = db.prepare("SELECT COUNT(*) as c FROM dead_letter_queue").get().c;
const recentMain = db.prepare("SELECT * FROM send_log ORDER BY sent_at DESC LIMIT 3").all();
const recentSaas = db.prepare("SELECT * FROM send_log_saas ORDER BY sent_at DESC LIMIT 3").all();

console.log('=== EMAIL STATUS ===');
console.log('Total email_records:', totalEmails);
console.log('With email address:', withEmail);
console.log('Main sent:', mainSent);
console.log('SaaS sent:', saasSent);
console.log('DLQ (failed):', dlq);
console.log('\n=== RECENT MAIN SENDS ===');
recentMain.forEach(r => console.log(`  ${r.email} | ${r.company_name} | ${r.sent_at}`));
console.log('\n=== RECENT SAAS SENDS ===');
recentSaas.forEach(r => console.log(`  ${r.email} | ${r.company_name} | ${r.status} | ${r.sent_at}`));
