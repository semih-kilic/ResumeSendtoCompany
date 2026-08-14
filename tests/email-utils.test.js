import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmail, isValidEmailForSend } from '../email-utils.js';

test('normalizeEmail fixes %20 prefix artifact', () => {
  assert.equal(normalizeEmail('%20tm@technoparc.com'), 'tm@technoparc.com');
});

test('normalizeEmail strips mailto and whitespace', () => {
  assert.equal(normalizeEmail('mailto: HR@Example.COM '), 'hr@example.com');
});

test('isValidEmailForSend rejects encoded garbage', () => {
  assert.equal(isValidEmailForSend('%20tm@technoparc.com'), true);
  assert.equal(isValidEmailForSend('not-an-email'), false);
  assert.equal(isValidEmailForSend('.bad@example.com'), false);
});
