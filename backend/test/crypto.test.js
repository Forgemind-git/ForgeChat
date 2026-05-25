'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');

// Set a dedicated encryption key BEFORE requiring the module — crypto.js reads
// it at load time. NODE_ENV is not 'production' here, so the prod guard is inert.
// Generated at runtime (never a literal) so secret scanners don't flag a
// key-shaped string in source; any >=32-char value works for the round-trip.
process.env.FORGECRM_ENCRYPTION_KEY = nodeCrypto.randomBytes(24).toString('hex');

const { encrypt, decrypt, maskSecret } = require('../src/util/crypto');

test('encrypt → decrypt round-trips the plaintext', () => {
  const secret = 'sample-meta-token-value-1234567890';
  const ct = encrypt(secret);
  assert.notEqual(ct, secret, 'ciphertext must differ from plaintext');
  assert.equal(decrypt(ct), secret);
});

test('encrypt produces a different ciphertext each call (random IV)', () => {
  const a = encrypt('same-value');
  const b = encrypt('same-value');
  assert.notEqual(a, b, 'IV reuse would make ciphertexts identical');
  assert.equal(decrypt(a), 'same-value');
  assert.equal(decrypt(b), 'same-value');
});

test('encrypt returns null for empty/nullish input', () => {
  assert.equal(encrypt(''), null);
  assert.equal(encrypt(null), null);
  assert.equal(encrypt(undefined), null);
});

test('decrypt returns null on a tampered ciphertext (GCM auth tag fails)', () => {
  const ct = encrypt('tamper-me');
  // Flip a character in the middle of the base64 to corrupt the ciphertext.
  // decrypt() catches the auth failure and returns null rather than throwing.
  const mid = Math.floor(ct.length / 2);
  const flipped = ct.slice(0, mid) + (ct[mid] === 'A' ? 'B' : 'A') + ct.slice(mid + 1);
  assert.equal(decrypt(flipped), null);
});

test('decrypt returns null on empty/garbage input', () => {
  assert.equal(decrypt(null), null);
  assert.equal(decrypt(''), null);
  assert.equal(decrypt('not-valid-base64-ciphertext'), null);
});

test('maskSecret hides the middle and never returns the raw secret', () => {
  const masked = maskSecret('sample-token-1234567890-ABCDEF');
  assert.notEqual(masked, 'sample-token-1234567890-ABCDEF');
  assert.match(masked, /•/);
});

test('maskSecret fully masks short values', () => {
  assert.equal(maskSecret('short'), '••••••••');
});
