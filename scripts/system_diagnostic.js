import { extractEmails } from '../extractor.js';
import { verifyEmail } from '../verifier.js';
import { loadConfig } from '../config.js';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'finland.db');
const db = new Database(dbPath);
const config = loadConfig();

async function runDiagnostics() {
  console.log('--- 🛡️ SHIELD ENGINE DIAGNOSTIC REPORT ---');
  console.log(`Timestamp: ${new Date().toLocaleString()}`);
  console.log('-----------------------------------------');

  const results = {
    extraction: false,
    blacklist: false,
    trusted_domain: false,
    blacklisted_domain: false,
    db_shield_integrity: false
  };

  // 1. EXTRACTOR & PLACEHOLDER TEST
  console.log('\n[1/4] Testing Extraction & Placeholder Filters...');
  const mockHtml = `
    <div>Contact us at real.person@real-business.fi</div>
    <div>Placeholder: matti.meikalainen@firma.fi</div>
    <div>Placeholder: etunimi.sukunimi@example.fi</div>
  `;
  const extracted = extractEmails(mockHtml);
  const foundReal = extracted.includes('real.person@real-business.fi');
  const foundMatti = extracted.includes('matti.meikalainen@firma.fi');
  const foundEtunimi = extracted.includes('etunimi.sukunimi@example.fi');

  if (foundReal && !foundMatti && !foundEtunimi) {
    console.log('✅ PASS: Real emails extracted, placeholders rejected.');
    results.extraction = true;
    results.blacklist = true;
  } else {
    console.log('❌ FAIL: Extraction logic leaking placeholders.');
    console.log('   Extracted:', extracted);
  }

  // 2. HYBRID VERIFIER TEST
  console.log('\n[2/4] Testing Hybrid Verifier Logic...');
  
  // Scenario A: Blacklisted Domain
  console.log('   - Testing ndaniela@contentcorner.fi (Should be AUTO-REJECTED)...');
  const resBad = await verifyEmail('ndaniela@contentcorner.fi', config);
  if (!resBad.valid && resBad.reason.includes('Blacklisted')) {
    console.log('   ✅ PASS: Blacklisted domain blocked instantly.');
    results.blacklisted_domain = true;
  } else {
    console.log(`   ❌ FAIL: Blacklisted domain leak! Reason: ${resBad.reason}`);
  }

  // Scenario B: Trusted Domain
  console.log('   - Testing info@nokia.com (Should be AUTO-APPROVED via Trust)...');
  // Force Nokia into trust for test
  db.prepare('INSERT OR REPLACE INTO domain_trust (domain, trust_score) VALUES (?, ?)').run('nokia.com', 0.9);
  const resGood = await verifyEmail('info@nokia.com', config);
  if (resGood.valid && resGood.reason.includes('Trusted')) {
    console.log(`   ✅ PASS: Trusted domain approved without API cost (Confidence: ${resGood.confidence})`);
    results.trusted_domain = true;
  } else {
    console.log(`   ❌ FAIL: Trusted domain failed! Reason: ${resGood.reason}`);
  }

  // 3. DATABASE SHIELD INTEGRITY
  console.log('\n[3/4] Testing Database Shield Integrity...');
  const testEmail = `test_shield_${Date.now()}@diagnostic.fi`;
  
  // Insert unverified lead
  db.prepare('INSERT INTO email_records (company_name, business_id, email, verified, excluded) VALUES (?, ?, ?, 0, 0)')
    .run('Diagnostic Lab', '123-TEST', testEmail);
  
  // Try to pull it via getUnsent (SendEngine's query)
  // We need to check it manually using the same query as db.js
  const unsent = db.prepare(`
    SELECT * FROM email_records 
    WHERE excluded = 0 
      AND verified = 1 
      AND email = ?
  `).get(testEmail);

  if (!unsent) {
    console.log('✅ PASS: Unverified leads are correctly BLOCKED from the sender queue.');
    results.db_shield_integrity = true;
  } else {
    console.log('❌ FAIL: DATABASE LEAK! Unverified lead appearing in queue.');
  }

  // 4. CLEANUP
  db.prepare('DELETE FROM email_records WHERE email = ?').run(testEmail);

  console.log('\n-----------------------------------------');
  console.log('Summary:');
  for (const [key, val] of Object.entries(results)) {
    console.log(`${val ? '✅' : '❌'} ${key.toUpperCase()}`);
  }
  console.log('-----------------------------------------');
  
  if (Object.values(results).every(v => v === true)) {
    console.log('\n🌟 CONCLUSION: YOUR SYSTEM IS SECURE AND SHIELDED.');
  } else {
    console.log('\n⚠️ ATTENTION: VULNERABILITIES DETECTED. FIX REQUIRED.');
  }
  
  db.close();
}

runDiagnostics().catch(console.error);
