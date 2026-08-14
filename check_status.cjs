const DB = require('better-sqlite3');
const db = new DB('./data/canada.db');

// Tables
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('=== TABLES ===');
console.log(tables.map(t => t.name).join(', '));

// Companies columns
const cols = db.prepare("PRAGMA table_info(companies)").all();
console.log('\n=== COMPANIES COLUMNS ===');
console.log(cols.map(c => c.name).join(', '));

// Basic stats
console.log('\n=== STATS ===');
try {
  const totalCompanies = db.prepare('SELECT COUNT(*) as c FROM companies').get();
  console.log('Total Companies:', totalCompanies.c);
} catch(e) { console.log('companies error:', e.message); }

try {
  const emails = db.prepare('SELECT COUNT(*) as c FROM email_records WHERE verified=1').get();
  console.log('Verified Emails:', emails.c);
} catch(e) { console.log('email_records error:', e.message); }

try {
  const saasTotal = db.prepare('SELECT COUNT(*) as c FROM send_log_saas').get();
  console.log('SaaS Total Sent:', saasTotal.c);
} catch(e) { console.log('send_log_saas error:', e.message); }

try {
  const coldTotal = db.prepare('SELECT COUNT(*) as c FROM send_log').get();
  console.log('Cold Mail Total Sent:', coldTotal.c);
} catch(e) { console.log('send_log error:', e.message); }

// Recent sends (last 24h)
try {
  const recentCold = db.prepare("SELECT COUNT(*) as c FROM send_log WHERE sent_at > datetime('now', '-24 hours')").get();
  console.log('Cold Mails (last 24h):', recentCold.c);
} catch(e) { console.log('recent cold error:', e.message); }

try {
  const recentSaas = db.prepare("SELECT COUNT(*) as c FROM send_log_saas WHERE sent_at > datetime('now', '-24 hours')").get();
  console.log('SaaS Mails (last 24h):', recentSaas.c);
} catch(e) { console.log('recent saas error:', e.message); }

// Last 5 sent emails
try {
  const lastSent = db.prepare('SELECT email, company_name, sent_at FROM send_log ORDER BY sent_at DESC LIMIT 5').all();
  console.log('\n=== LAST 5 COLD MAILS SENT ===');
  lastSent.forEach(r => console.log(`  ${r.sent_at} -> ${r.email} (${r.company_name})`));
} catch(e) { console.log('last sent error:', e.message); }

try {
  const lastSaas = db.prepare('SELECT email, company_name, sent_at FROM send_log_saas ORDER BY sent_at DESC LIMIT 5').all();
  console.log('\n=== LAST 5 SAAS MAILS SENT ===');
  lastSaas.forEach(r => console.log(`  ${r.sent_at} -> ${r.email} (${r.company_name})`));
} catch(e) { console.log('last saas error:', e.message); }

db.close();
