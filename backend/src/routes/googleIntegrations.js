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
  buildAuthUrl,
  verifyState,
  handleCallback,
  revokeAndDelete,
} = require('../services/googleAuth');
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
  return `${base}/#/admin-settings/google-integrations?${params.toString()}`;
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

/** Lightweight probe so the UI can show a helpful message when OAuth isn't set up. */
router.get('/google-integrations/status', (req, res) => {
  res.json({ configured: isConfigured() });
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
router.post('/google-integrations/authorize', (req, res) => {
  if (!isConfigured()) {
    return res.status(501).json({ error: 'Google OAuth is not configured on this server. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI in backend/.env and restart.' });
  }
  try {
    const nonce = crypto.randomBytes(16).toString('hex');
    const url = buildAuthUrl({ userId: req.user.id, nonce });
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
      'SELECT id FROM coexistence.oauth_credentials WHERE id = $1 AND user_id = $2 AND provider = $3',
      [req.params.id, req.user.id, PROVIDER],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
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
