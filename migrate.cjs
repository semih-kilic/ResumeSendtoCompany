// Database migration script to add missing columns
const DB = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbFiles = [
  path.join(__dirname, 'data', 'canada.db'),
  path.join(__dirname, '..', 'finland.db'), // parent folder has finland.db
  path.join(__dirname, 'data', 'finland.db'),
];

dbFiles.forEach(dbPath => {
  if (!fs.existsSync(dbPath)) {
    console.log(`[MIGRATION] Database not found: ${dbPath}, skipping.`);
    return;
  }
  
  console.log(`[MIGRATION] Checking database: ${dbPath}`);
  const db = new DB(dbPath);
  
  try {
    // Check if scraped_at column exists in companies table
    const columns = db.prepare("PRAGMA table_info(companies)").all();
    const hasScrapedAt = columns.some(c => c.name === 'scraped_at');
    
    if (!hasScrapedAt) {
      console.log(`[MIGRATION] Adding 'scraped_at' column to 'companies' table...`);
      db.exec('ALTER TABLE companies ADD COLUMN scraped_at TEXT;');
      console.log(`[MIGRATION] 'scraped_at' column added successfully!`);
    } else {
      console.log(`[MIGRATION] 'scraped_at' column already exists in 'companies' table.`);
    }
  } catch (e) {
    console.error(`[MIGRATION] Error migrating ${dbPath}:`, e.message);
  } finally {
    db.close();
  }
});

console.log('[MIGRATION] Completed.');
