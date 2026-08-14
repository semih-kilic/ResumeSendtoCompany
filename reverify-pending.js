import { verifyEmail } from './verifier.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Re-verify legacy saas_finder rows stuck at verified=0 (generic aliases).
 * Uses allowGeneric so info@ / contact@ can enter the SaaS send queue.
 */
export async function reverifyPendingSaasLeads(db, config, log, { batchSize = 50, delayMs = 150 } = {}) {
  const logger = typeof log === 'function'
    ? log
    : (level, msg) => console.log(`[REVERIFY] [${level.toUpperCase()}] ${msg}`);

  const pending = db.prepare(`
    SELECT id, email, company_name, business_id
    FROM email_records
    WHERE source = 'saas_finder'
      AND verified = 0
      AND excluded = 0
      AND business_id LIKE 'SAAS-%'
    ORDER BY found_date ASC
    LIMIT ?
  `).all(batchSize);

  if (pending.length === 0) {
    return { processed: 0, verified: 0, excluded: 0 };
  }

  logger('info', `Re-verifying ${pending.length} pending SaaS leads (allowGeneric)...`);

  let verified = 0;
  let excluded = 0;

  for (const record of pending) {
    try {
      const result = await verifyEmail(record.email, { ...config, allowGeneric: true });
      if (result.valid) {
        db.prepare(`
          UPDATE email_records
          SET verified = 1, verification_score = ?, excluded = 0
          WHERE id = ?
        `).run(result.score ?? result.confidence ?? 0.6, record.id);
        verified++;
        logger('info', `Verified ${record.email} (${record.company_name})`);
      } else {
        db.prepare('UPDATE email_records SET excluded = 1 WHERE id = ?').run(record.id);
        excluded++;
        logger('debug', `Excluded ${record.email}: ${result.reason}`);
      }
    } catch (err) {
      logger('warn', `Reverify error for ${record.email}: ${err.message}`);
    }
    await sleep(delayMs);
  }

  logger('info', `Reverify batch done: ${verified} verified, ${excluded} excluded`);
  return { processed: pending.length, verified, excluded };
}

/** Process every pending SaaS lead until none remain. */
export async function reverifyAllPendingSaasLeads(db, config, log, opts = {}) {
  const totals = { processed: 0, verified: 0, excluded: 0 };
  while (true) {
    const batch = await reverifyPendingSaasLeads(db, config, log, opts);
    totals.processed += batch.processed;
    totals.verified += batch.verified;
    totals.excluded += batch.excluded;
    if (batch.processed === 0) break;
  }
  return totals;
}
