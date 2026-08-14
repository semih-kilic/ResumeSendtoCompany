const Database = require('better-sqlite3');
const db = new Database('data/canada.db');

// Get email_records schema
const cols = db.prepare("PRAGMA table_info(email_records)").all();
console.log('email_records columns:', cols.map(c => c.name).join(', '));

// Get send_log schema
const cols2 = db.prepare("PRAGMA table_info(send_log)").all();
console.log('send_log columns:', cols2.map(c => c.name).join(', '));

// Get send_log_saas schema
const cols3 = db.prepare("PRAGMA table_info(send_log_saas)").all();
console.log('send_log_saas columns:', cols3.map(c => c.name).join(', '));
