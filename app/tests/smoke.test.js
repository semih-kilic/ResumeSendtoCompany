import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

import request from 'supertest';
import { createApp } from '../server.js';

test('GET /api/health returns ok', async () => {
  process.env.DATA_DIR = path.join(os.tmpdir(), `lg2f-test-health-${Date.now()}`);

  const { app } = createApp();

  const res = await request(app).get('/api/health').expect(200);
  assert.equal(res.body.ok, true);
  assert.equal(typeof res.body.ts, 'number');
});

test('GET /api/stats returns json', async () => {
  process.env.DATA_DIR = path.join(os.tmpdir(), `lg2f-test-${Date.now()}`);

  const { app } = createApp();

  const res = await request(app).get('/api/stats').expect(200);
  assert.equal(res.headers['content-type']?.includes('application/json'), true);
  assert.equal(typeof res.body, 'object');
});

