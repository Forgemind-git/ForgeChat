const { Router } = require('express');
const pool = require('../db');
const { encrypt, decrypt, maskSecret } = require('../util/crypto');

const router = Router();

// Single-owner system: roles were removed, so the JWT no longer carries a
// `role`. Every authenticated request is the owner (the sole admin), so gate
// these account-management routes on authentication only.
function adminOnly(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

/**
 * Look up a phone number's human-readable number + verified business name from
 * the Meta Graph API. The simplified connection form no longer asks the user to
 * type these, so we derive them from the Phone Number ID + access token. Also
 * doubles as a credential check. Throws on a non-2xx Meta response.
 */
async function fetchPhoneMeta(phoneNumberId, accessToken) {
  const version = process.env.META_API_VERSION || 'v21.0';
  const apiUrl = `https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`;
  const resp = await fetch(apiUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  const text = await resp.text();
  let body = {};
  try { body = JSON.parse(text); } catch { /* non-JSON error body */ }
  if (!resp.ok) {
    throw new Error(body?.error?.message || text || `HTTP ${resp.status}`);
  }
  return body; // { display_phone_number, verified_name, id }
}

function publicShape(row, { reveal = false } = {}) {
  if (!row) return null;
  const token = decrypt(row.access_token_encrypted);
  return {
    id: row.id,
    displayName: row.display_name,
    displayPhoneNumber: row.display_phone_number,
    phoneNumberId: row.phone_number_id,
    wabaId: row.waba_id,
    metaAppId: row.meta_app_id,
    accessTokenMasked: maskSecret(token),
    accessToken: reveal ? token : undefined,
    verifyToken: row.verify_token_encrypted ? decrypt(row.verify_token_encrypted) : '',
    isDefault: row.is_default,
    isActive: row.is_active,
    healthStatus: row.health_status || 'unknown',
    lastErrorAt: row.last_error_at,
    lastErrorMessage: row.last_error_message,
    lastSuccessAt: row.last_success_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// List all accounts (any authenticated user — needed for template/broadcast pickers)
router.get('/whatsapp-accounts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM coexistence.whatsapp_accounts
        WHERE ($1::boolean IS NULL OR is_active = $1)
        ORDER BY is_default DESC, display_name ASC`,
      [req.query.activeOnly === 'true' ? true : null]
    );
    res.json(rows.map(r => publicShape(r)));
  } catch (err) {
    console.error('[whatsapp-accounts] list error:', err.message);
    res.status(500).json({ error: 'Failed to list WhatsApp Business accounts' });
  }
});

// Resolve account by phone (must be registered before :id so it doesn't match :id=by-phone)
router.get('/whatsapp-accounts/by-phone/:phone', async (req, res) => {
  try {
    const acc = await getAccountByPhoneNumber(req.params.phone);
    if (!acc) return res.status(404).json({ error: 'No WhatsApp Business account registered for this phone' });
    res.json({
      id: acc.id,
      displayName: acc.displayName,
      displayPhoneNumber: acc.displayPhoneNumber,
      phoneNumberId: acc.phoneNumberId,
      wabaId: acc.wabaId,
      isActive: acc.isActive,
    });
  } catch (err) {
    console.error('[whatsapp-accounts] by-phone error:', err.message);
    res.status(500).json({ error: 'Failed to resolve account' });
  }
});

// Get one — admins see the decrypted token (?reveal=1)
router.get('/whatsapp-accounts/:id', adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM coexistence.whatsapp_accounts WHERE id = $1',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(publicShape(rows[0], { reveal: req.query.reveal === '1' }));
  } catch (err) {
    console.error('[whatsapp-accounts] get error:', err.message);
    res.status(500).json({ error: 'Failed to fetch WhatsApp Business account' });
  }
});

router.post('/whatsapp-accounts', adminOnly, async (req, res) => {
  try {
    const { phoneNumberId, wabaId, accessToken, verifyToken, metaAppId } = req.body || {};
    if (!phoneNumberId || !wabaId || !accessToken) {
      return res.status(400).json({ error: 'Phone Number ID, WhatsApp Business Account ID and Permanent Access Token are required' });
    }

    // Single-account system: refuse to register a second WhatsApp Business account.
    const { rows: existing } = await pool.query('SELECT COUNT(*)::int AS n FROM coexistence.whatsapp_accounts');
    if (existing[0].n >= 1) {
      return res.status(409).json({ error: 'Only one WhatsApp Business account is allowed. Edit the existing account instead.' });
    }

    // Best-effort: resolve the human-readable number + verified business name
    // from Meta so chat threading and display still work without the user
    // typing them. Saving proceeds even if the lookup fails (logged).
    let displayName = `WhatsApp ${wabaId.trim()}`;
    let displayPhoneNumber = '';
    try {
      const meta = await fetchPhoneMeta(phoneNumberId.trim(), accessToken.trim());
      if (meta.verified_name) displayName = meta.verified_name;
      if (meta.display_phone_number) displayPhoneNumber = String(meta.display_phone_number).replace(/\D/g, '');
    } catch (e) {
      console.warn('[whatsapp-accounts] Meta phone lookup failed (saving anyway):', e.message);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // The lone account is always the default and active.
      const { rows } = await client.query(
        `INSERT INTO coexistence.whatsapp_accounts
          (display_name, display_phone_number, phone_number_id, waba_id, meta_app_id,
           access_token_encrypted, verify_token_encrypted, is_default, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,TRUE)
         RETURNING *`,
        [
          displayName, displayPhoneNumber, phoneNumberId.trim(), wabaId.trim(),
          metaAppId?.trim() || null,
          encrypt(accessToken.trim()), encrypt((verifyToken || '').trim()),
        ]
      );
      await client.query('COMMIT');
      res.status(201).json(publicShape(rows[0]));
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'This Phone Number ID is already connected' });
    console.error('[whatsapp-accounts] create error:', err.message);
    res.status(500).json({ error: 'Failed to create WhatsApp Business account' });
  }
});

router.put('/whatsapp-accounts/:id', adminOnly, async (req, res) => {
  try {
    const { phoneNumberId, wabaId, accessToken, verifyToken, metaAppId, isActive } = req.body || {};
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: existingRows } = await client.query(
        'SELECT * FROM coexistence.whatsapp_accounts WHERE id = $1', [req.params.id]
      );
      if (existingRows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Not found' });
      }
      const ex = existingRows[0];

      const newPhoneId = phoneNumberId != null ? phoneNumberId.trim() : ex.phone_number_id;
      const newWaba = wabaId != null ? wabaId.trim() : ex.waba_id;
      const tokenChanged = !!(accessToken && accessToken.trim());
      const effectiveToken = tokenChanged ? accessToken.trim() : decrypt(ex.access_token_encrypted);

      // Re-derive the display fields from Meta when the number or token changes.
      let displayName = ex.display_name;
      let displayPhoneNumber = ex.display_phone_number;
      if ((phoneNumberId != null && newPhoneId !== ex.phone_number_id) || tokenChanged) {
        try {
          const meta = await fetchPhoneMeta(newPhoneId, effectiveToken);
          if (meta.verified_name) displayName = meta.verified_name;
          if (meta.display_phone_number) displayPhoneNumber = String(meta.display_phone_number).replace(/\D/g, '');
        } catch (e) {
          console.warn('[whatsapp-accounts] Meta phone lookup failed on update (keeping previous):', e.message);
        }
      }

      const sets = ['updated_at = NOW()'];
      const params = [];
      let i = 1;
      const push = (col, val) => { sets.push(`${col} = $${i++}`); params.push(val); };
      push('display_name', displayName);
      push('display_phone_number', displayPhoneNumber);
      push('phone_number_id', newPhoneId);
      push('waba_id', newWaba);
      if (metaAppId !== undefined) push('meta_app_id', metaAppId?.trim() || null);
      if (tokenChanged) {
        push('access_token_encrypted', encrypt(effectiveToken));
        // Reset health on token update so the UI banner clears.
        push('health_status', 'unknown');
        push('last_error_message', null);
      }
      if (verifyToken !== undefined) push('verify_token_encrypted', encrypt((verifyToken || '').trim()));
      if (isActive != null) push('is_active', !!isActive);
      params.push(req.params.id);
      const { rows } = await client.query(
        `UPDATE coexistence.whatsapp_accounts SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
        params
      );
      await client.query('COMMIT');
      res.json(publicShape(rows[0]));
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'This Phone Number ID is already connected' });
    console.error('[whatsapp-accounts] update error:', err.message);
    res.status(500).json({ error: 'Failed to update WhatsApp Business account' });
  }
});

router.delete('/whatsapp-accounts/:id', adminOnly, async (req, res) => {
  try {
    // Single-account system: never delete the connected account — it would stop
    // all sends. To switch numbers, edit the existing account instead.
    const { rows: cnt } = await pool.query('SELECT COUNT(*)::int AS n FROM coexistence.whatsapp_accounts');
    if (cnt[0].n <= 1) {
      return res.status(409).json({ error: 'Cannot delete the only WhatsApp Business account. Edit it to change the connected number.' });
    }
    const { rowCount } = await pool.query(
      'DELETE FROM coexistence.whatsapp_accounts WHERE id = $1',
      [req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[whatsapp-accounts] delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete WhatsApp Business account' });
  }
});

// Normalise phone numbers for matching: strip everything but digits.
function normalizePhone(p) {
  return String(p || '').replace(/\D/g, '');
}

function rowToCreds(r) {
  if (!r) return null;
  return {
    id: r.id,
    displayName: r.display_name,
    displayPhoneNumber: r.display_phone_number,
    phoneNumberId: r.phone_number_id,
    wabaId: r.waba_id,
    accessToken: decrypt(r.access_token_encrypted),
    isActive: r.is_active,
  };
}

async function getAccountWithToken(accountId) {
  const { rows } = await pool.query(
    'SELECT * FROM coexistence.whatsapp_accounts WHERE id = $1',
    [accountId]
  );
  return rowToCreds(rows[0]);
}

/**
 * Return the single connected account (this product is capped at one). Used as
 * a fallback when phone-number matching can't resolve an account — e.g. the
 * display number hasn't been derived from Meta yet.
 */
async function getSingleAccount() {
  const { rows } = await pool.query(
    'SELECT * FROM coexistence.whatsapp_accounts ORDER BY is_default DESC, id ASC LIMIT 1'
  );
  return rowToCreds(rows[0]);
}

/**
 * Resolve the WhatsApp account that owns the given phone number. Used by
 * broadcasts and automation message nodes to derive credentials from a
 * "from" phone number. Matches by digits-only normalisation so users can
 * register the number as "+919342245724" or "919342245724".
 */
async function getAccountByPhoneNumber(phoneOrId) {
  const norm = normalizePhone(phoneOrId);
  if (!norm) return null;
  const { rows } = await pool.query(
    `SELECT * FROM coexistence.whatsapp_accounts
       WHERE regexp_replace(display_phone_number, '\\D', '', 'g') = $1
          OR phone_number_id = $2
       LIMIT 1`,
    [norm, String(phoneOrId)]
  );
  return rowToCreds(rows[0]);
}

module.exports = { router, getAccountWithToken, getAccountByPhoneNumber, getSingleAccount };
