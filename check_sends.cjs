const Database = require('better-sqlite3');
const db = new Database('data/canada.db');

const pending = db.prepare("SELECT COUNT(*) as c FROM email_records WHERE main_sent=0 AND saas_sent=0").get().c;
const mainSent = db.prepare("SELECT COUNT(*) as c FROM email_records WHERE main_sent=1").get().c;
const saasSent = db.prepare("SELECT COUNT(*) as c FROM email_records WHERE saas_sent=1").get().c;
const total = db.prepare("SELECT COUNT(*) as c FROM email_records").get().c;
const withEmail = db.prepare("SELECT COUNT(*) as c FROM email_records WHERE email IS NOT NULL AND email != ''").get().c;

console.log('Total email_records:', total);
console.log('With email:', withEmail);
console.log('Pending (not sent):', pending);
console.log('Main sent:', mainSent);
console.log('SaaS sent:', saasSent);
