import test from 'node:test';
import assert from 'node:assert/strict';
import { externalAccountMessage, externalPairCode, externalPairTarget } from '../src/pairing.ts';

test('external pairing binds the server to an exact trusted top-level origin', () => {
  assert.equal(externalPairTarget('https://contextbridge-newpoluton.vercel.app/#settings').apiUrl, 'https://contextbridge-newpoluton.vercel.app');
  assert.equal(externalPairTarget('http://localhost:5173/').apiUrl, 'http://localhost:3000');
  for (const origin of ['https://contextbridge-newpoluton.vercel.app.evil.test/', 'https://evil.test/', 'http://localhost:9000/', 'http://contextbridge-newpoluton.vercel.app/']) assert.throws(() => externalPairTarget(origin));
  assert.throws(() => externalPairTarget('https://contextbridge-newpoluton.vercel.app/', 'https://evil.test'));
  assert.throws(() => externalPairTarget('https://contextbridge-newpoluton.vercel.app/', undefined, 1));
});

test('external website can submit only a bounded one-time pairing code', () => {
  const code = 'single_use_code_1234567890';
  assert.equal(externalPairCode({ type: 'CB_PAIR', code }), code);
  for (const message of [{ type: 'api', code }, { type: 'CB_PAIR', code, apiUrl: 'https://evil.test' }, { type: 'CB_PAIR', code: 'short' }, { type: 'CB_PAIR', code: 'x'.repeat(101) }, { type: 'CB_PAIR', code: 'code with spaces'.repeat(3) }]) assert.throws(() => externalPairCode(message));
});


test('status and sign-out accept only a bounded expected account identity', () => {
  assert.deepEqual(externalAccountMessage({ type: 'CB_STATUS', accountId: 'account-123' }), { type: 'CB_STATUS', accountId: 'account-123' });
  assert.equal(externalAccountMessage({ type: 'CB_DISCONNECT', accountId: 'account-123' }).type, 'CB_DISCONNECT');
  for (const message of [{ type: 'CB_STATUS' }, { type: 'CB_DISCONNECT', accountId: '' }, { type: 'CB_STATUS', accountId: 'x'.repeat(201) }, { type: 'CB_STATUS', accountId: 'account-123', token: 'secret' }, { type: 'CB_STATUS', accountId: '../other' }]) assert.throws(() => externalAccountMessage(message));
  assert.equal(externalPairCode({ type: 'CB_PAIR', code: 'single_use_code_1234567890', accountId: 'account-123' }), 'single_use_code_1234567890');
  assert.throws(() => externalPairCode({ type: 'CB_PAIR', code: 'single_use_code_1234567890', accountId: '' }));
});
