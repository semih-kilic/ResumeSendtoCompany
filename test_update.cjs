const DB = require('better-sqlite3');
const path = require('path');
const db = new DB(path.join(__dirname, 'data', 'canada.db'));

try {
  const testId = 'CA-WEB-506c6169642d70'; // Plaid
  const res = db.prepare('UPDATE companies SET scraped_at = datetime("now") WHERE business_id = ?').run(testId);
  console.log('Update result:', res);
  const row = db.prepare('SELECT * FROM companies WHERE business_id = ?').get(testId);
  console.log('Row after update:', row);
} catch (e) {
  console.error('Error during update:', e.message);
} finally {
  db.close();
}
