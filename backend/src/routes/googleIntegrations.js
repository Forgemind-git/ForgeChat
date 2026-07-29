// Google Integrations API.
//
//  GET    /api/google-integrations              List connected Google accounts
//  POST   /api/google-integrations/authorize    Get Google consent URL (start of flow)
//  GET    /api/google-integrations/callback     OAuth callback (Google redirects here)
//  DELETE /api/google-integrations/:id          Disconnect (revoke + delete)
//  GET    /api/google-integrations/status       Lightweight "is this configured on the server?"
//
// Note: /callback is hit by the user's browser AFTER they approve in Google,
// not by Google directly, so the request still carries the auth cookie. The
// callback finishes by 302-redirecting the browser back to the frontend
// settings tab with ?connected=1 (or ?error=...) so the React UI refreshes
// itself.

const { Router } = require('express');
const crypto = require('crypto');
const pool = require('../db');
const {
  PROVIDER,
  isConfigured,
  getCredentialsForDisplay,
  getOAuthCredentials,
  saveCredentials,
  deleteCredentials,
  buildAuthUrl,
  verifyState,
  handleCallback,
  revokeAndDelete,
  canListDriveFiles,
} = require('../services/googleAuth');
const { adminOnly } = require('../middleware/access');
const googleSheets = require('../services/googleSheets');

// Public router: only the callback. Google's redirect lands the user's browser
// here without our cookie guaranteed (SameSite=Lax can drop it across an OAuth
// hop in some browsers), so we re-derive the user from the signed state token.
const publicRouter = Router();

// Protected router: everything else requires the caller to be signed in.
const router = Router();

/**
 * Where to send the user's browser after the OAuth dance finishes. Falls back
 * to "/" if CORS_ORIGIN isn't set (dev). Trailing-slash safe.
 */
function frontendSettingsUrl({ status, error, label }) {
  const base = (process.env.CORS_ORIGIN || '/').replace(/\/+$/, '');
  const params = new URLSearchParams();
  if (status) params.set('google', status);
  if (error) params.set('error', error.slice(0, 200));
  if (label) params.set('label', label);
  // Land on the Google card's detail view inside the renamed Integrations tab.
  return `${base}/#/admin-settings/integrations/google?${params.toString()}`;
}

function publicShape(row) {
  return {
    id: row.id,
    provider: row.provider,
    accountLabel: row.account_label,
    scopes: row.scopes || [],
    healthStatus: row.health_status,
    lastErrorMessage: row.last_error_message,
    lastRefreshedAt: row.last_refreshed_at,
    accessTokenExpiresAt: row.access_token_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Lightweight probe so the UI can show a helpful message when OAuth isn't
 *  configured yet — AND so users can see the exact redirect URI the admin
 *  authorized in Google Cloud Console (mismatches here are the #1 cause of
 *  failed consent redirects). redirectUri is empty until an admin saves the
 *  credentials. */
router.get('/google-integrations/status', async (req, res) => {
  try {
    const creds = await getOAuthCredentials();
    res.json({
      configured: !!creds,
      redirectUri: creds ? creds.redirectUri : '',
    });
  } catch (err) {
    console.error('[google-integrations] status error:', err.message);
    res.status(500).json({ error: 'Failed to read Google integration status' });
  }
});

/**
 * Admin-only management of the workspace's Google OAuth app credentials
 * (Client ID / Secret / Redirect URI). These identify this ForgeChat install to
 * Google and are shared across all users' connections, so only admins may read
 * or change them — same posture as the AI Models registry. The Client Secret is
 * never returned in plaintext.
 */
router.get('/google-integrations/credentials', adminOnly, async (req, res) => {
  try {
    const reveal = req.query.reveal === '1';
    res.json(await getCredentialsForDisplay({ reveal }));
  } catch (err) {
    console.error('[google-integrations] credentials GET error:', err.message);
    res.status(500).json({ error: 'Failed to load Google credentials' });
  }
});

router.put('/google-integrations/credentials', adminOnly, async (req, res) => {
  const { clientId, clientSecret, redirectUri } = req.body || {};
  try {
    await saveCredentials({ clientId, clientSecret, redirectUri, userId: req.user.id });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'VALIDATION') return res.status(400).json({ error: err.message });
    console.error('[google-integrations] credentials PUT error:', err.message);
    res.status(500).json({ error: 'Failed to save Google credentials' });
  }
});

router.delete('/google-integrations/credentials', adminOnly, async (req, res) => {
  try {
    await deleteCredentials();
    res.json({ ok: true });
  } catch (err) {
    console.error('[google-integrations] credentials DELETE error:', err.message);
    res.status(500).json({ error: 'Failed to remove Google credentials' });
  }
});

router.get('/google-integrations', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM coexistence.oauth_credentials
        WHERE user_id = $1 AND provider = $2
        ORDER BY created_at DESC`,
      [req.user.id, PROVIDER],
    );
    res.json(rows.map(publicShape));
  } catch (err) {
    console.error('[google-integrations] list error:', err.message);
    res.status(500).json({ error: 'Failed to list Google integrations' });
  }
});

/**
 * Returns the URL the frontend should send the user to. The frontend opens it
 * as a full-window navigation (not a popup) — Google's consent screen breaks
 * inside popups in many browser configurations, and the callback redirects
 * cleanly back to the settings tab anyway.
 */
router.post('/google-integrations/authorize', async (req, res) => {
  try {
    if (!(await isConfigured())) {
      return res.status(501).json({ error: 'Google is not configured yet. Add your Google OAuth Client ID, Client Secret, and Redirect URI in Settings → Integrations → Google.' });
    }
    const nonce = crypto.randomBytes(16).toString('hex');
    const url = await buildAuthUrl({ userId: req.user.id, nonce });
    res.json({ authUrl: url });
  } catch (err) {
    console.error('[google-integrations] authorize error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to start Google authorization' });
  }
});

/**
 * Google redirects the user's browser here with ?code=... &state=... (or
 * ?error=... if the user denied consent). Always 302's back to the frontend
 * — never returns JSON — so the UX is a single tab switch.
 *
 * No authMiddleware: this is mounted on the public auth path because Google's
 * redirect can't carry our session cookie predictably across some browsers'
 * SameSite rules. We re-derive the user from the signed state token.
 */
publicRouter.get('/google-integrations/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) {
    return res.redirect(frontendSettingsUrl({ status: 'error', error: String(error) }));
  }
  if (!code || !state) {
    return res.redirect(frontendSettingsUrl({ status: 'error', error: 'Missing code or state' }));
  }
  const payload = verifyState(String(state));
  if (!payload) {
    return res.redirect(frontendSettingsUrl({ status: 'error', error: 'Invalid or expired state' }));
  }
  try {
    const row = await handleCallback({ code: String(code), userId: payload.uid });
    res.redirect(frontendSettingsUrl({ status: 'connected', label: row.account_label }));
  } catch (err) {
    console.error('[google-integrations] callback error:', err.message);
    res.redirect(frontendSettingsUrl({ status: 'error', error: err.message || 'OAuth callback failed' }));
  }
});

// Pick-list endpoints used by the agent's Sheets tool config UI.
// Both scope the credential lookup to the caller's user_id so one user can't
// list another user's Google data.
router.get('/google-integrations/:id/spreadsheets', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, scopes FROM coexistence.oauth_credentials WHERE id = $1 AND user_id = $2 AND provider = $3',
      [req.params.id, req.user.id, PROVIDER],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    // An account connected with only drive.file can't list pre-existing sheets —
    // Drive's files.list returns nothing, which used to show an unexplained empty
    // picker. Surface it so the UI can prompt a reconnect to grant drive.readonly.
    if (!canListDriveFiles(rows[0].scopes)) {
      return res.status(409).json({
        error: 'This Google account was connected without permission to list your spreadsheets. Reconnect it to grant read access to your Drive.',
        code: 'DRIVE_SCOPE_MISSING',
      });
    }
    const files = await googleSheets.listSpreadsheets(req.params.id, { query: req.query.q || '' });
    res.json(files);
  } catch (err) {
    console.error('[google-integrations] list spreadsheets error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to list spreadsheets' });
  }
});

router.get('/google-integrations/:id/spreadsheets/:spreadsheetId/tabs', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id FROM coexistence.oauth_credentials WHERE id = $1 AND user_id = $2 AND provider = $3',
      [req.params.id, req.user.id, PROVIDER],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const tabs = await googleSheets.listSheetTabs(req.params.id, req.params.spreadsheetId);
    res.json(tabs);
  } catch (err) {
    console.error('[google-integrations] list tabs error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to list sheet tabs' });
  }
});

router.delete('/google-integrations/:id', async (req, res) => {
  try {
    // Make sure the credential being deleted belongs to the caller — without
    // this scope check any authenticated user could disconnect anyone else's
    // Google account by guessing IDs.
    const { rows } = await pool.query(
      'SELECT id FROM coexistence.oauth_credentials WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const ok = await revokeAndDelete(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[google-integrations] delete error:', err.message);
    res.status(500).json({ error: 'Failed to disconnect Google account' });
  }
});

module.exports = { router, publicRouter };
