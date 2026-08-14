const db = require('better-sqlite3')('./data/canada.db');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('TABLES:', tables.map(t => t.name).join(', '));
tables.forEach(t => {
  try {
    const r = db.prepare('SELECT count(*) as c FROM ' + t.name).get();
    console.log(t.name + ':', r.c);
  } catch(e) {
    console.log(t.name + ': ERROR -', e.message);
  }
});
db.close();
