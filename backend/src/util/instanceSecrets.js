// Zero-config secret bootstrap.
//
// Resolves JWT_SECRET and FORGECRM_ENCRYPTION_KEY so the app boots with no
// manual .env editing. Precedence per secret:
//   (1) a strong value already in the environment  -> use it (never persisted)
//   (2) a value persisted in <DATA_DIR>/instance.json -> load into env
//   (3) otherwise -> generate a 32-byte hex key, persist it (chmod 600), use it
//
// This runs SYNCHRONOUSLY and MUTATES process.env BEFORE auth.js / crypto.js are
// required, so their existing top-level reads pick up the resolved values
// unchanged. Call it as the very first thing in index.js (after dotenv).
//
// CRITICAL: the persisted file lives on a Docker volume (default /app/data). The
// encryption key MUST stay stable across restarts — if it changes, previously
// encrypted WhatsApp tokens (whatsapp_accounts.*_encrypted, ai_models.*) become
// unreadable (decrypt() returns null and the admin must re-enter them). Never
// point DATA_DIR at an ephemeral path in production.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Placeholders shipped in docs / old .env.example — treat as "not set".
const WEAK = new Set([
  'forgecrm-dev-secret-change-me',
  'change-this-to-a-random-string',
  'change-this-to-another-random-string',
]);

const isStrong = (v) => typeof v === 'string' && v.length >= 32 && !WEAK.has(v);

function dataDir() {
  return process.env.FORGECHAT_DATA_DIR || '/app/data';
}
function filePath() {
  return path.join(dataDir(), 'instance.json');
}
function readFile() {
  try {
    return JSON.parse(fs.readFileSync(filePath(), 'utf8')) || {};
  } catch {
    return {};
  }
}
function persist(obj) {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = filePath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, ...obj }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, filePath()); // atomic replace
}

function bootstrapSecrets() {
  const file = readFile();
  const persisted = {};      // keys that belong in the file (file-origin or generated)
  let generatedAny = false;

  const resolve = (envName, key) => {
    const envVal = process.env[envName];
    if (isStrong(envVal)) {
      if (isStrong(file[key]) && file[key] !== envVal) {
        console.warn(
          `[instance] ${envName} from the environment differs from the persisted value; using the environment value. ` +
          `If the persisted key previously encrypted data, set ${envName} to that exact value or encrypted tokens will be unreadable.`
        );
      }
      return; // env-provided secrets are honoured but never written to disk
    }
    if (envVal) {
      console.warn(`[instance] ${envName} is set but weak/short — ignoring it and using the persisted/generated key instead.`);
    }
    if (isStrong(file[key])) {
      process.env[envName] = file[key];
      persisted[key] = file[key];
      return;
    }
    const gen = crypto.randomBytes(32).toString('hex'); // 64 hex chars
    process.env[envName] = gen;
    persisted[key] = gen;
    generatedAny = true;
  };

  resolve('JWT_SECRET', 'jwtSecret');
  resolve('FORGECRM_ENCRYPTION_KEY', 'encryptionKey');

  if (generatedAny) {
    try {
      persist({ ...persisted, generatedAt: file.generatedAt || new Date().toISOString() });
      console.log(
        `[instance] Generated instance secret(s) and saved them to ${filePath()} (chmod 600). ` +
        `Keep the ${dataDir()} volume — losing it makes encrypted WhatsApp tokens unrecoverable.`
      );
    } catch (err) {
      // The one acceptable hard failure: we needed to persist a generated key
      // but cannot. Continuing with an ephemeral key would corrupt encryption on
      // the next restart, so fail loudly with an actionable message.
      throw new Error(
        `[instance] cannot persist instance secrets to ${filePath()}: ${err.message}. ` +
        `Mount a writable volume at ${dataDir()} (or set JWT_SECRET + FORGECRM_ENCRYPTION_KEY).`
      );
    }
  }
}

module.exports = { bootstrapSecrets, isStrong };
