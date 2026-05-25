// AES-256-GCM symmetric encryption for sensitive secrets stored in the DB
// (currently: Meta WhatsApp access tokens). Format: base64(iv || tag || ct)
// where iv=12B, tag=16B, ct=variable. Derives a 32-byte key by SHA-256 of
// FORGECRM_ENCRYPTION_KEY (falls back to JWT_SECRET so dev doesn't break).

const crypto = require('crypto');

const RAW = process.env.FORGECRM_ENCRYPTION_KEY || process.env.JWT_SECRET || '';
// In production, require a dedicated encryption key — don't silently fall back
// to JWT_SECRET (or an empty key) for access tokens stored at rest. Also reject
// the well-known placeholders from .env.example / DEPLOY.md and low-entropy
// values (the source is public).
const WEAK_KEYS = new Set([
  'change-this-to-another-random-string',
  'change-this-to-a-random-string',
  'forgecrm-dev-secret-change-me',
]);
if (process.env.NODE_ENV === 'production' &&
    (!process.env.FORGECRM_ENCRYPTION_KEY ||
     WEAK_KEYS.has(process.env.FORGECRM_ENCRYPTION_KEY) ||
     process.env.FORGECRM_ENCRYPTION_KEY.length < 32)) {
  console.error('[crypto] FATAL: FORGECRM_ENCRYPTION_KEY must be a strong, unique value (>=32 chars) in production. Generate one with: openssl rand -hex 32');
  process.exit(1);
}
if (!RAW) {
  console.warn('[crypto] WARNING: neither FORGECRM_ENCRYPTION_KEY nor JWT_SECRET set — encryption will use empty key');
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

module.exports = { encrypt, decrypt, maskSecret };
