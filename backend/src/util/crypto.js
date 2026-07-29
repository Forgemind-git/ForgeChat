// AES-256-GCM symmetric encryption for sensitive secrets stored in the DB
// (currently: Meta WhatsApp access tokens). Format: base64(iv || tag || ct)
// where iv=12B, tag=16B, ct=variable. Derives a 32-byte key by SHA-256 of
// FORGECRM_ENCRYPTION_KEY.
//
// The key is guaranteed present + strong by util/instanceSecrets.bootstrapSecrets(),
// which runs first in index.js (resolves from env, else a persisted file, else
// auto-generates one). So there is no boot-time guard here anymore; we only keep
// a defensive fallback for non-standard entry points (tests/scripts).

const crypto = require('crypto');

const RAW = process.env.FORGECRM_ENCRYPTION_KEY || process.env.JWT_SECRET || '';
if (!RAW) {
  console.warn('[crypto] WARNING: no encryption key in env — encryption will use an empty key. Run via index.js so instanceSecrets bootstraps one.');
}
const KEY = crypto.createHash('sha256').update(RAW).digest(); // 32 bytes

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function encrypt(plaintext) {
  if (plaintext == null || plaintext === '') return null;
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

function decrypt(ciphertextB64) {
  if (!ciphertextB64) return null;
  try {
    const buf = Buffer.from(ciphertextB64, 'base64');
    if (buf.length < IV_LEN + TAG_LEN + 1) throw new Error('ciphertext too short');
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch (err) {
    console.error('[crypto] decrypt failed:', err.message);
    return null;
  }
}

/**
 * Mask a secret for display in admin UI: keep first 4 + last 4 chars, mask the
 * middle with a fixed-length asterisk run (so length isn't leaked).
 */
function maskSecret(s) {
  if (!s) return '';
  const str = String(s);
  if (str.length <= 8) return '••••••••';
  return `${str.slice(0, 4)}••••••••${str.slice(-4)}`;
}

// SHA-256 hex of an API key. MCP bearer keys are HASHED (not encrypted) — we
// only ever store the hash and compare; the plaintext is shown once at creation.
function hashApiKey(plain) {
  return crypto.createHash('sha256').update(String(plain)).digest('hex');
}

module.exports = { encrypt, decrypt, maskSecret, hashApiKey };
