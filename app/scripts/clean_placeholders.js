import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'finland.db');
const db = new Database(dbPath);

const patterns = [
  'etunimi.sukunimi',
  'firstname.lastname',
  'forename.surname',
  'first.last',
  'name.surname',
  'your.name',
  'matti.meikalainen',
  'yourname',
  'testname',
  'forename',
  'surname'
];

let deletedCount = 0;
const deleteStmt = db.prepare('DELETE FROM email_records WHERE LOWER(email) LIKE ?');

console.log('--- Cleaning Lead Database ---');
patterns.forEach(p => {
  const info = deleteStmt.run(`%${p}%`);
  if (info.changes > 0) {
    console.log(`Removed ${info.changes} records matching pattern: ${p}`);
  }
  deletedCount += info.changes;
});

console.log('----------------------------');
console.log(`Total Leads Cleaned: ${deletedCount}`);
db.close();
