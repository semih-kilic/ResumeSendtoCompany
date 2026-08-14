const Database = require('better-sqlite3');
const db = new Database('data/canada.db');
const maps = db.prepare("SELECT COUNT(*) as c FROM companies WHERE source='Google Maps'").get().c;
const total = db.prepare('SELECT COUNT(*) as c FROM companies').get().c;
console.log('Google Maps companies:', maps, '/', total);

// Source breakdown
const sources = db.prepare("SELECT source, COUNT(*) as c FROM companies GROUP BY source ORDER BY c DESC").all();
sources.forEach(s => console.log(`  ${s.source}: ${s.c}`));
