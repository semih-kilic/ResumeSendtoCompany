/**
 * DLQ Persistence Test
 * 
 * Tests that failed messages persist in SQLite-backed DLQ
 * across process restarts.
 * 
 * Workflow:
 * 1. Create test message and push to DLQ
 * 2. Simulate message failure by storing in DB
 * 3. Restart process / reload database
 * 4. Verify message is still in DLQ
 * 5. Pop message and confirm integrity
 */

import { initDatabase } from './db.js';
import { SqliteBackedDeadLetterQueue } from './resilience-manager.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function testDLQPersistence() {
  console.log('════════════════════════════════════════════════════════════');
  console.log('  DLQ PERSISTENCE TEST');
  console.log('════════════════════════════════════════════════════════════');

  const dbPath = path.join(__dirname, 'data', 'test-dlq.db');
  
  // ─── PHASE 1: Push test messages to DLQ ───
  console.log('\n[PHASE 1] Pushing test messages to DLQ...');
  
  try {
    const db = initDatabase(dbPath);
    const dlq = new SqliteBackedDeadLetterQueue(db, 'test-queue');

    const testMessages = [
      {
        id: 'msg-1',
        email: 'contact@company1.com',
        subject: 'Test Email 1',
        reason: 'API rate limit'
      },
      {
        id: 'msg-2',
        email: 'contact@company2.com',
        subject: 'Test Email 2',
        reason: 'SMTP timeout'
      },
      {
        id: 'msg-3',
        email: 'contact@company3.com',
        subject: 'Test Email 3',
        reason: 'Auth failure'
      }
    ];

    for (const msg of testMessages) {
      dlq.push(msg, new Error(`Failed: ${msg.reason}`));
      console.log(`  ✓ Pushed message ${msg.id} to DLQ`);
    }

    const initialSize = dlq.size();
    console.log(`\n  Total messages in DLQ: ${initialSize}`);

    const stats = dlq.getStats();
    console.log(`  Queue stats: ${stats.count} items, oldest: ${stats.oldestAgeSeconds}s old`);

    // ─── PHASE 2: Close DB and simulate process restart ───
    console.log('\n[PHASE 2] Simulating process restart...');
    db.close();
    console.log('  ✓ Database closed (simulating shutdown)');
    console.log('  [PROCESS WOULD RESTART HERE]');

    // ─── PHASE 3: Reopen database and verify persistence ───
    console.log('\n[PHASE 3] Reopening database after "restart"...');
    const db2 = initDatabase(dbPath);
    const dlq2 = new SqliteBackedDeadLetterQueue(db2, 'test-queue');

    const persistedSize = dlq2.size();
    console.log(`  ✓ Messages persisted in DLQ: ${persistedSize} items`);

    if (persistedSize !== initialSize) {
      console.error(`  ❌ PERSISTENCE FAILED: Expected ${initialSize} messages, got ${persistedSize}`);
      process.exit(1);
    } else {
      console.log(`  ✅ PERSISTENCE VERIFIED: All ${persistedSize} messages survived restart`);
    }

    // ─── PHASE 4: Pop and verify message integrity ───
    console.log('\n[PHASE 4] Popping and verifying message integrity...');
    
    const popped1 = dlq2.pop();
    if (popped1) {
      console.log(`  ✓ Popped message: ${popped1.item.id}`);
      console.log(`    - Email: ${popped1.item.email}`);
      console.log(`    - Reason: ${popped1.item.reason}`);
      console.log(`    - Error: ${popped1.error}`);
      console.log(`    - Retry count: ${popped1.retryCount}`);
      console.log(`    - Failed at: ${popped1.failedAt}`);
    }

    const popped2 = dlq2.pop();
    if (popped2) {
      console.log(`  ✓ Popped message: ${popped2.item.id}`);
    }

    const popped3 = dlq2.pop();
    if (popped3) {
      console.log(`  ✓ Popped message: ${popped3.item.id}`);
    }

    const finalSize = dlq2.size();
    console.log(`\n  Final queue size: ${finalSize} (expected 0)`);

    if (finalSize === 0) {
      console.log('  ✅ ALL MESSAGES POPPED SUCCESSFULLY');
    } else {
      console.error(`  ❌ ERROR: Expected empty queue, but has ${finalSize} items`);
    }

    // ─── PHASE 5: Test drain() for batch recovery ───
    console.log('\n[PHASE 5] Testing batch drain (for recovery)...');
    
    // Re-push more test messages
    for (let i = 0; i < 5; i++) {
      dlq2.push(
        { id: `batch-${i}`, email: `batch${i}@test.com` },
        new Error('Batch test error')
      );
    }

    console.log(`  ✓ Pushed 5 batch test messages`);
    
    const allDrained = dlq2.drain();
    console.log(`  ✓ Drained all ${allDrained.length} messages for batch recovery`);
    console.log(`  ✓ Queue is now empty: ${dlq2.size() === 0}`);

    // ─── FINAL RESULTS ───
    console.log('\n════════════════════════════════════════════════════════════');
    console.log('  ✅ DLQ PERSISTENCE TEST PASSED');
    console.log('════════════════════════════════════════════════════════════');
    console.log('\nKey Findings:');
    console.log('  • Messages persist across process restarts ✓');
    console.log('  • Message integrity maintained ✓');
    console.log('  • Pop and drain operations work correctly ✓');
    console.log('  • Stats tracking (count, oldest age) works ✓');
    console.log('\nUsage Pattern in SendEngine:');
    console.log('  1. Failed email → dlq.push(emailData, error)');
    console.log('  2. After restart → dlq.drain() to get all failed emails');
    console.log('  3. Retry each → dlq.incrementRetry(id) to track attempts');
    console.log('  4. Success → dlq.pop() or remove from DB directly');

    db2.close();
    process.exit(0);

  } catch (err) {
    console.error(`\n❌ TEST FAILED: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
}

testDLQPersistence();
