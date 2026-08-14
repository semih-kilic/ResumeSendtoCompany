import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, countUnsentSaaS } from '../db.js';
import { loadConfig } from '../config.js';
import { reverifyAllPendingSaasLeads } from '../reverify-pending.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = initDatabase(path.join(__dirname, '../data/canada.db'));
const config = loadConfig();

const totals = await reverifyAllPendingSaasLeads(
  db,
  config,
  (level, msg) => console.log(`[REVERIFY] [${level.toUpperCase()}] ${msg}`),
  { batchSize: 100, delayMs: 50 }
);

console.log('\n=== REVERIFY COMPLETE ===');
console.log(totals);
console.log('SaaS queue size:', countUnsentSaaS(db));
