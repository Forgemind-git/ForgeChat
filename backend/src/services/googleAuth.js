// Google OAuth helper. Owns the OAuth2 client lifecycle (consent URL → token
// exchange → store-encrypted → refresh) for the generic coexistence.oauth_credentials
// table, with provider='google'. v1 scopes cover Google Sheets only; Gmail +
// Calendar will append scopes here in a follow-up release without schema change.
//
// The *app-level* OAuth client (Client ID / Secret / Redirect URI) is NOT read
// from env vars — it is configured by an admin in the UI and stored encrypted in
// coexistence.google_oauth_credentials (migration 055). buildOAuthClient() loads
// it from there on every call, so rotating it takes effect without a restart.
//
// State CSRF: the OAuth `state` param is a short-lived JWT signed with JWT_SECRET
// that pins the request to a specific user_id + nonce. The callback rejects any
// mismatch, so a returning Google redirect can't be replayed against another user.

const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { encrypt, decrypt } = require('../util/crypto');

const PROVIDER = 'google';

// v1: Sheets-only. drive.readonly is what lets the spreadsheet picker actually
// LIST the user's existing sheets — the Sheets API can only read/write a sheet
// whose id you already know, and the narrower drive.file scope only surfaces
// files the app itself created or the user opened through a Google Picker, so
// pre-existing sheets never appear in the dropdown. drive.readonly + Drive's
// files.list is the only way to discover them (matches the internal build).
const SHEETS_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/spreadsheets',
  // openid + email + profile let us derive the account_label (email) without a
  // second API call.
  'openid',
  'email',
  'profile',
];

// Scopes that let Drive's files.list surface the user's PRE-EXISTING
// spreadsheets — what the agent Sheets picker needs. The narrower drive.file
// scope only exposes files the app itself created or the user opened through a
// Picker, so an account connected with only drive.file shows an empty picker.
// When that's the case the UI should prompt a reconnect to grant one of these.
const DRIVE_LIST_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive',
];
function canListDriveFiles(scopes = []) {
  return (scopes || []).some(s => DRIVE_LIST_SCOPES.includes(s));
}

const STATE_TTL_SECONDS = 10 * 60; // 10 min consent window

/**
 * Load the workspace's Google OAuth app credentials from the DB (newest row
 * wins), decrypting the Client ID + Secret. Returns null when no admin has
 * configured them yet. This is the single source of truth — there is no env-var
 * fallback (configuration is UI-only).
 */
async function getOAuthCredentials() {
  const { rows } = await pool.query(
    `SELECT id, client_id_encrypted, client_secret_encrypted, redirect_uri, updated_at
       FROM coexistence.google_oauth_credentials
      ORDER BY id DESC LIMIT 1`,
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  const clientId = decrypt(r.client_id_encrypted);
  const clientSecret = decrypt(r.client_secret_encrypted);
  if (!clientId || !clientSecret || !r.redirect_uri) return null;
  return { id: r.id, clientId, clientSecret, redirectUri: r.redirect_uri, updatedAt: r.updated_at };
}

/** True when an admin has saved a complete, decryptable set of credentials. */
async function isConfigured() {
  return !!(await getOAuthCredentials());
}

/**
 * Admin-facing view of the saved credentials. The Client ID is NOT a secret
 * (Google embeds it in the consent URL) so it is shown in full. The Client
 * Secret is only included when `reveal` is set — the admin-only management
 * screen asks for it explicitly so the admin can see/verify what is integrated
 * (same posture as the AI Models registry's ?reveal=1).
 */
async function getCredentialsForDisplay({ reveal = false } = {}) {
  const creds = await getOAuthCredentials();
  if (!creds) return { configured: false };
  const out = {
    configured: true,
    clientId: creds.clientId,
    redirectUri: creds.redirectUri,
    updatedAt: creds.updatedAt,
  };
  if (reveal) out.clientSecret = creds.clientSecret;
  return out;
}

/**
 * Create or update the workspace credentials. On update, an empty clientSecret
 * keeps the existing one (so an admin can change the Client ID or Redirect URI
 * without re-typing the secret). Throws with a friendly message when the secret
 * is required but missing.
 */
async function saveCredentials({ clientId, clientSecret, redirectUri, userId }) {
  const id = String(clientId || '').trim();
  const redirect = String(redirectUri || '').trim();
  const secret = String(clientSecret || '').trim();
  if (!id) { const e = new Error('Client ID is required.'); e.code = 'VALIDATION'; throw e; }
  if (!redirect) { const e = new Error('Redirect URI is required.'); e.code = 'VALIDATION'; throw e; }

  const { rows: existing } = await pool.query(
    `SELECT id, client_secret_encrypted FROM coexistence.google_oauth_credentials ORDER BY id DESC LIMIT 1`,
  );

  let secretEnc;
  if (secret) {
    secretEnc = encrypt(secret);
  } else if (existing.length > 0) {
    secretEnc = existing[0].client_secret_encrypted; // keep existing
  } else {
    const e = new Error('Client Secret is required when configuring Google for the first time.');
    e.code = 'VALIDATION';
    throw e;
  }

  if (existing.length === 0) {
    await pool.query(
      `INSERT INTO coexistence.google_oauth_credentials
         (client_id_encrypted, client_secret_encrypted, redirect_uri, updated_by)
       VALUES ($1, $2, $3, $4)`,
      [encrypt(id), secretEnc, redirect, userId || null],
    );
  } else {
    await pool.query(
      `UPDATE coexistence.google_oauth_credentials
          SET client_id_encrypted = $1,
              client_secret_encrypted = $2,
              redirect_uri = $3,
              updated_by = $4,
              updated_at = NOW()
        WHERE id = $5`,
      [encrypt(id), secretEnc, redirect, userId || null, existing[0].id],
    );
  }
}

/** Remove the saved credentials. New connections can't start until re-saved. */
async function deleteCredentials() {
  await pool.query('DELETE FROM coexistence.google_oauth_credentials');
}

async function buildOAuthClient() {
  const creds = await getOAuthCredentials();
  if (!creds) {
    const err = new Error('Google is not configured yet. Add your Google OAuth Client ID, Client Secret, and Redirect URI in Settings → Integrations → Google.');
    err.code = 'GOOGLE_OAUTH_NOT_CONFIGURED';
    throw err;
  }
  return new google.auth.OAuth2(creds.clientId, creds.clientSecret, creds.redirectUri);
}

function signState({ userId, nonce }) {
  return jwt.sign(
    { uid: userId, n: nonce, kind: 'google_oauth_state' },
    process.env.JWT_SECRET || 'forgecrm-dev-secret-change-me',
    { expiresIn: STATE_TTL_SECONDS },
  );
}

function verifyState(state) {
  try {
    const payload = jwt.verify(
      state,
      process.env.JWT_SECRET || 'forgecrm-dev-secret-change-me',
    );
    if (payload.kind !== 'google_oauth_state') return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Build the Google consent URL the user is sent to.
 *  access_type=offline + prompt=consent force Google to return a refresh_token
 *  every time (without prompt=consent, Google only emits a refresh_token on the
 *  FIRST consent — re-connecting the same account would leave us tokenless).
 */
async function buildAuthUrl({ userId, nonce, scopes = SHEETS_SCOPES }) {
  const client = await buildOAuthClient();
  // NOTE: `include_granted_scopes` is intentionally OFF. With it on, Google
  // adds back every scope the user has ever granted to this OAuth Client
  // (e.g. Gmail, Calendar, full Drive from a previous setup) on top of what
  // we're requesting now. v1 of this feature only needs Sheets + drive.readonly
  // (to list the user's spreadsheets in the picker), so we request exactly
  // those. If the user previously granted broader scopes, they
  // should revoke this app at https://myaccount.google.com/permissions
  // before reconnecting to get a clean minimal-permissions consent screen.
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: scopes,
    state: signState({ userId, nonce }),
  });
}

/**
 * Exchange an auth code for tokens, derive the user's Google email from the
 * id_token, and upsert into oauth_credentials (encrypted).
 */
async function handleCallback({ code, userId }) {
  const client = await buildOAuthClient();
  const { tokens } = await client.getToken(code);
  // tokens: { access_token, refresh_token, id_token, expiry_date, scope, token_type }

  if (!tokens.refresh_token) {
    // This can happen if the user previously consented and we didn't pass
    // prompt=consent — unrecoverable here because Google won't give us a refresh
    // token, so the connection would silently die in an hour. Surface clearly.
    const err = new Error('Google did not return a refresh token. Revoke the app from your Google Account → Security → Third-party access, then try connecting again.');
    err.code = 'NO_REFRESH_TOKEN';
    throw err;
  }

  // Pull the email out of the id_token (no extra API call). The id_token is a
  // JWT signed by Google; we trust the values because we just got it over TLS
  // straight from Google's token endpoint via the official SDK.
  let email = null;
  if (tokens.id_token) {
    const parts = tokens.id_token.split('.');
    if (parts.length === 3) {
      try {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
        if (payload && typeof payload.email === 'string') email = payload.email;
      } catch { /* ignore — fall through to label below */ }
    }
  }
  const accountLabel = email || `google-${Date.now()}`;

  const scopes = (tokens.scope || '').split(' ').filter(Boolean);
  const expiresAt = tokens.expiry_date ? new Date(tokens.expiry_date) : null;

  // Upsert: re-connecting the same Google account updates the existing row
  // (refresh token rotates) instead of failing with a unique-violation.
  const { rows } = await pool.query(
    `INSERT INTO coexistence.oauth_credentials
       (user_id, provider, account_label,
        refresh_token_encrypted, access_token_encrypted, access_token_expires_at,
        scopes, health_status, last_refreshed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'ok', NOW())
     ON CONFLICT (user_id, provider, account_label) DO UPDATE
        SET refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
            access_token_encrypted  = EXCLUDED.access_token_encrypted,
            access_token_expires_at = EXCLUDED.access_token_expires_at,
            scopes                  = EXCLUDED.scopes,
            health_status           = 'ok',
            last_error_message      = NULL,
            last_refreshed_at       = NOW(),
            updated_at              = NOW()
     RETURNING *`,
    [
      userId, PROVIDER, accountLabel,
      encrypt(tokens.refresh_token), encrypt(tokens.access_token || ''),
      expiresAt, scopes,
    ],
  );
  return rows[0];
}

/**
 * Return a valid access token for the given credential row, refreshing via the
 * refresh_token if the cached one expired (or is within a 60s safety window).
 * Persists the refreshed access_token + expires_at back to the DB.
 */
async function getAccessToken(credentialId) {
  const { rows } = await pool.query(
    'SELECT * FROM coexistence.oauth_credentials WHERE id = $1',
    [credentialId],
  );
  if (rows.length === 0) {
    const err = new Error('OAuth credential not found');
    err.code = 'CREDENTIAL_NOT_FOUND';
    throw err;
  }
  const row = rows[0];

  const now = Date.now();
  const expiresAt = row.access_token_expires_at ? new Date(row.access_token_expires_at).getTime() : 0;
  const cached = decrypt(row.access_token_encrypted);
  if (cached && expiresAt > now + 60 * 1000) {
    return cached;
  }

  // Refresh.
  const client = await buildOAuthClient();
  const refreshToken = decrypt(row.refresh_token_encrypted);
  if (!refreshToken) {
    await markUnhealthy(credentialId, 'Refresh token missing or unreadable; reconnect this Google account.');
    const err = new Error('Refresh token unavailable; reconnect this Google account.');
    err.code = 'REFRESH_TOKEN_MISSING';
    throw err;
  }
  client.setCredentials({ refresh_token: refreshToken });
  let creds;
  try {
    const r = await client.refreshAccessToken();
    creds = r.credentials;
  } catch (err) {
    await markUnhealthy(credentialId, `Refresh failed: ${err.message}`);
    throw err;
  }
  const newAccess = creds.access_token;
  const newExpiry = creds.expiry_date ? new Date(creds.expiry_date) : null;
  await pool.query(
    `UPDATE coexistence.oauth_credentials
        SET access_token_encrypted = $1,
            access_token_expires_at = $2,
            health_status = 'ok',
            last_error_message = NULL,
            last_refreshed_at = NOW(),
            updated_at = NOW()
      WHERE id = $3`,
    [encrypt(newAccess), newExpiry, credentialId],
  );
  return newAccess;
}

async function markUnhealthy(credentialId, message) {
  try {
    await pool.query(
      `UPDATE coexistence.oauth_credentials
          SET health_status = 'error',
              last_error_message = $1,
              updated_at = NOW()
        WHERE id = $2`,
      [String(message || '').slice(0, 1000), credentialId],
    );
  } catch (e) {
    console.error('[googleAuth] markUnhealthy failed:', e.message);
  }
}

/**
 * Best-effort token revocation at Google's end. Always followed by a DB delete
 * by the caller — we don't want a Google API hiccup to leave a dead row.
 */
async function revokeAndDelete(credentialId) {
  const { rows } = await pool.query(
    'SELECT refresh_token_encrypted FROM coexistence.oauth_credentials WHERE id = $1',
    [credentialId],
  );
  if (rows.length === 0) return false;
  const refreshToken = decrypt(rows[0].refresh_token_encrypted);
  if (refreshToken) {
    try {
      const client = await buildOAuthClient();
      await client.revokeToken(refreshToken);
    } catch (e) {
      console.warn('[googleAuth] revokeToken failed (deleting locally anyway):', e.message);
    }
  }
  const { rowCount } = await pool.query(
    'DELETE FROM coexistence.oauth_credentials WHERE id = $1',
    [credentialId],
  );
  return rowCount > 0;
}

module.exports = {
  PROVIDER,
  SHEETS_SCOPES,
  canListDriveFiles,
  isConfigured,
  getOAuthCredentials,
  getCredentialsForDisplay,
  saveCredentials,
  deleteCredentials,
  buildAuthUrl,
  verifyState,
  handleCallback,
  getAccessToken,
  markUnhealthy,
  revokeAndDelete,
};
