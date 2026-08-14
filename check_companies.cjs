const Database = require('better-sqlite3');
const db = new Database('data/canada.db');
const cols = db.prepare("PRAGMA table_info(companies)").all();
console.log('companies columns:', cols.map(c => c.name).join(', '));
