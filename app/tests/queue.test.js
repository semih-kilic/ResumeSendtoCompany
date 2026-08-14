import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

import { initDatabase, getUnsent, getUnsentSaaS, countUnsentJob, countUnsentSaaS, insertEmailRecord } from '../db.js';

test('queue counts match getUnsent helpers', () => {
  const dataDir = path.join(os.tmpdir(), `lg2f-queue-${Date.now()}`);
  const dbPath = path.join(dataDir, 'test.db');
  const db = initDatabase(dbPath);

  insertEmailRecord(db, {
    company_name: 'Acme SaaS',
    business_id: 'SAAS-FIND-abc123',
    website: 'https://acme.example',
    email: 'info@acme.example',
    email_type: 'info',
    source: 'saas_finder',
    verified: 1,
    verification_score: 0.7,
  });

  insertEmailRecord(db, {
    company_name: 'Job Co',
    business_id: 'CHAMBER-deadbeef',
    website: 'https://job.example',
    email: 'hr@job.example',
    email_type: 'hr',
    source: 'website',
    verified: 1,
    verification_score: 0.8,
  });

  assert.equal(getUnsentSaaS(db).length, 1);
  assert.equal(countUnsentSaaS(db), 1);
  assert.equal(getUnsent(db).length, 1);
  assert.equal(countUnsentJob(db), 1);

  db.prepare('INSERT INTO send_log_saas (email, company_name) VALUES (?, ?)').run('info@acme.example', 'Acme SaaS');

  assert.equal(countUnsentSaaS(db), 0);
  assert.equal(countUnsentJob(db), 1);

  db.close();
});
