import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'finland.db');
const db = new Database(dbPath);

console.log('--- STARTING HYBRID MIGRATION ---');

try {
  // 1. Create domain_trust table
  db.exec(`
    CREATE TABLE IF NOT EXISTS domain_trust (
      domain TEXT PRIMARY KEY,
      trust_score REAL DEFAULT 0,
      is_catchall INTEGER DEFAULT 0,
      last_checked TEXT DEFAULT (datetime('now')),
      metadata TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_domain_trust_score ON domain_trust(trust_score);
  `);
  console.log('✅ Table domain_trust created/verified.');

  // 2. Initialize domain_trust from existing verified leads
  // This gives a head start to known good domains
  const verifiedDomains = db.prepare(`
    SELECT DISTINCT SUBSTR(email, INSTR(email, '@') + 1) as domain
    FROM email_records
    WHERE verified = 1 AND excluded = 0
  `).all();
  
  for (const row of verifiedDomains) {
    db.prepare(`
      INSERT OR IGNORE INTO domain_trust (domain, trust_score, last_checked)
      VALUES (?, 0.9, datetime('now'))
    `).run(row.domain);
  }
  console.log(`✅ Initialized trust for ${verifiedDomains.length} domains.`);

  // 3. Blacklist known bad domains (from existing excluded records)
  const badDomains = db.prepare(`
    SELECT DISTINCT SUBSTR(email, INSTR(email, '@') + 1) as domain
    FROM email_records
    WHERE excluded = 1
  `).all();
  
  for (const row of badDomains) {
    db.prepare(`
      INSERT OR REPLACE INTO domain_trust (domain, trust_score, last_checked)
      VALUES (?, -1.0, datetime('now'))
    `).run(row.domain);
  }
  console.log(`✅ Blacklisted ${badDomains.length} untrusted domains.`);

  console.log('--- MIGRATION COMPLETE ---');
} catch (e) {
  console.error('Migration failed:', e);
} finally {
  db.close();
}
