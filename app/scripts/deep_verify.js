import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

import { verifyEmail } from '../verifier.js';
import { loadConfig } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'finland.db');
const db = new Database(dbPath);
const config = loadConfig();

async function runDeepClean() {
  console.log('--- STARTING DEEP DATABASE CLEAN (API ENABLED) ---');
  
  if (config.verification?.api_key) {
    console.log(`Using API provider: ${config.verification.provider}`);
  } else {
    console.log('WARNING: No API key found. Falling back to SMTP (may fail on this network).');
  }

  // 1. Get all unsent leads
  const unsent = db.prepare(`
    SELECT * FROM email_records 
    WHERE excluded = 0 
    AND email NOT IN (SELECT email FROM send_log)
  `).all();
  
  // Parse limit from args
  const limitArg = process.argv.find(arg => arg.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : null;
  
  let leadsToProcess = unsent;
  if (limit) {
    leadsToProcess = unsent.slice(0, limit);
    console.log(`Limiting check to the first ${limit} leads.`);
  }

  console.log(`Processing ${leadsToProcess.length} leads.`);
  
  let processed = 0;
  let excludedCount = 0;
  let verifiedCount = 0;
  for (let i = 0; i < leadsToProcess.length; i++) {
    const record = leadsToProcess[i];
    console.log(`[PROGRESS] Verifying lead ${i + 1}/${leadsToProcess.length}: ${record.email}`);
    
    try {
      const v = await verifyEmail(record.email, config);
      processed++;
      
      if (!v.valid) {
        db.prepare('UPDATE email_records SET excluded = 1, verified = 0 WHERE id = ?').run(record.id);
        excludedCount++;
        console.log(`❌ [REJECTED] ${record.email} - ${v.reason}`);
      } else {
        db.prepare('UPDATE email_records SET verified = 1, verification_score = ? WHERE id = ?').run(v.score, record.id);
        verifiedCount++;
        console.log(`✅ [VERIFIED] ${record.email} - Score: ${v.score || 'N/A'}`);
      }
    } catch (e) {
      console.log(`⚠️ [ERROR] ${record.email} - ${e.message}`);
    }
    
    // Abstract API Free Tier is 1 request per SECOND.
    // We add a safety delay of 1.2 seconds.
    await new Promise(r => setTimeout(r, 1200));
  }
  
  console.log('----------------------------');
  console.log('CLEANUP COMPLETE');
  console.log(`Processed: ${processed}`);
  console.log(`Kept: ${verifiedCount}`);
  console.log(`Excluded (Poisoned): ${excludedCount}`);
  console.log('----------------------------');
  
  db.close();
}

runDeepClean().catch(console.error);
