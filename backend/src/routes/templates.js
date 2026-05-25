const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requirePermission } = require('../middleware/access');
const { canonicalizeMime, isTemplateHeaderMime, TEMPLATE_TYPES_MSG } = require('../util/metaMime');

// ─── Helpers ──────────────────────────────────────────────────────────────────
const extractVars = (t) => {
  const m = [...(t || '').matchAll(/\{\{(\d+)\}\}/g)];
  return [...new Set(m.map(x => x[1]))].sort((a, b) => +a - +b);
};

const nameOk = (n) => /^[a-z0-9_]+$/.test(n);

function runValidation(data) {
  const e = {};
  const { name, body, header_type, header_text, media_handle, footer, buttons, samples, category, code_expiry_minutes } = data;

  if (!name || !name.trim()) e.name = 'Template name is required';
  else if (!nameOk(name)) e.name = 'Only lowercase letters, numbers, underscores';
  else if (name.length > 512) e.name = 'Max 512 characters';

  if (!body || !body.trim()) e.body = 'Body text is required';

  const hv = header_type === 'TEXT' ? extractVars(header_text) : [];
  if (hv.length > 1) e.headerVars = 'Header allows only 1 variable — {{1}}';
  if (header_text && header_text.length > 60) e.headerTextLen = 'Header text max 60 characters';

  if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(header_type) && !(media_handle || '').trim()) {
    e.mediaHandle = 'Meta file handle required for media header';
  }

  if (extractVars(footer).length > 0) e.footer = 'Footer cannot contain variables';
  if (footer && footer.length > 60) e.footerLen = 'Footer max 60 characters';

  const bv = extractVars(body);
  const miss = bv.filter(v => !(samples || {})[v]?.trim());
  if (miss.length > 0) e.bodySamples = `Fill samples for: ${miss.map(v => `{{${v}}}`).join(', ')}`;
  if (hv.length > 0 && !(samples || {})[hv[0]]?.trim()) e.headerSamples = `Fill sample for header {{${hv[0]}}}`;

  const btnArr = buttons || [];
  const urlBtns = btnArr.filter(b => b.type === 'URL');
  const phoneBtns = btnArr.filter(b => b.type === 'PHONE_NUMBER');
  if (urlBtns.length > 2) e.btnMaxUrl = 'Max 2 URL buttons';
  if (phoneBtns.length > 1) e.btnMaxPhone = 'Max 1 phone button';

  btnArr.forEach((btn, i) => {
    if (!btn.text?.trim() && btn.type !== 'OTP') e[`btn_text_${i}`] = 'Button text required';
    if (btn.type === 'URL') {
      if (btn.value && !btn.value.startsWith('https://')) e[`btn_url_${i}`] = 'URL must start with https://';
      if (extractVars(btn.value || '').length > 0 && !btn.urlSample?.trim()) {
        e[`btn_urlsample_${i}`] = 'Sample URL required for dynamic URL variable';
      }
    }
    if (btn.type === 'PHONE_NUMBER' && btn.value) {
      const clean = (btn.value || '').replace(/[\s\-()]/g, '');
      if (!/^\+\d{7,15}$/.test(clean)) e[`btn_phone_${i}`] = 'Use E.164 format: +919876543210';
    }
  });

  if (category === 'AUTHENTICATION' && code_expiry_minutes !== null && code_expiry_minutes !== undefined && code_expiry_minutes !== '') {
    const n = +code_expiry_minutes;
    if (isNaN(n) || n < 1 || n > 90) e.codeExpiry = 'Expiry must be 1–90 minutes';
  }

  return e;
}

function buildPayload(data) {
  const { name, category, language, header_type, header_text, media_handle, body, footer, buttons, samples, security_recommendation, code_expiry_minutes, allow_category_change } = data;
  const components = [];

  if (header_type !== 'NONE') {
    const hc = { type: 'HEADER', format: header_type };
    if (header_type === 'TEXT') {
      hc.text = header_text;
      const hv = extractVars(header_text);
      if (hv.length > 0) hc.example = { header_text: [samples[hv[0]] || 'Sample'] };
    } else {
      if (media_handle) hc.example = { header_handle: [media_handle] };
    }
    components.push(hc);
  }

  const bc = { type: 'BODY', text: body };
  if (security_recommendation && category === 'AUTHENTICATION') bc.add_security_recommendation = true;
  const bv = extractVars(body);
  if (bv.length > 0) bc.example = { body_text: [bv.map(v => samples[v] || `sample_${v}`)] };
  components.push(bc);

  if (category !== 'AUTHENTICATION' && footer) components.push({ type: 'FOOTER', text: footer });
  if (category === 'AUTHENTICATION' && code_expiry_minutes) components.push({ type: 'FOOTER', code_expiration_minutes: parseInt(code_expiry_minutes) });

  const btnArr = buttons || [];
  if (btnArr.length > 0) {
    const btns = btnArr.map(b => {
      if (b.type === 'OTP') {
        return {
          type: 'OTP',
          otp_type: b.otpType || 'COPY_CODE',
          text: b.text || 'Copy Code',
          ...(b.otpType === 'ONE_TAP' ? { autofill_text: 'Autofill', package_name: b.packageName || '', signature_hash: b.signatureHash || '' } : {})
        };
      }
      if (b.type === 'URL') {
        const uv = extractVars(b.value || '');
        return { type: 'URL', text: b.text, url: b.value, ...(uv.length > 0 ? { example: [b.urlSample || b.value] } : {}) };
      }
      if (b.type === 'PHONE_NUMBER') return { type: 'PHONE_NUMBER', text: b.text, phone_number: b.value };
      if (b.type === 'COPY_CODE') return { type: 'COPY_CODE', example: [b.value || 'PROMO50'] };
      return { type: 'QUICK_REPLY', text: b.text };
    });
    components.push({ type: 'BUTTONS', buttons: btns });
  }

  return { name, language, category, allow_category_change: allow_category_change, components };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /templates — list all
router.get('/templates', async (req, res) => {
  try {
    const { accountId, status, q } = req.query;
    const where = [];
    const params = [];
    if (accountId === 'unassigned') {
      where.push('t.whatsapp_account_id IS NULL');
    } else if (accountId) {
      params.push(accountId);
      where.push(`t.whatsapp_account_id = $${params.length}`);
    }
    if (status && status !== 'all') {
      params.push(status);
      where.push(`t.status = $${params.length}`);
    }
    if (q && String(q).trim()) {
      params.push(`%${String(q).trim().toLowerCase()}%`);
      where.push(`(lower(t.name) LIKE $${params.length} OR lower(t.body) LIKE $${params.length})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT t.id, t.name, t.category, t.language, t.header_type, t.header_text, t.media_handle,
              t.header_media_library_id, t.body, t.footer,
              t.buttons, t.samples, t.security_recommendation, t.code_expiry_minutes,
              t.allow_category_change, t.status, t.meta_template_id, t.submitted_at,
              t.quality_score, t.rejection_reason, t.previous_category, t.last_synced_at,
              t.template_group_key,
              t.created_at, t.updated_at,
              t.whatsapp_account_id AS "whatsappAccountId",
              wa.display_name AS "whatsappAccountName",
              wa.display_phone_number AS "whatsappAccountPhone",
              (SELECT COUNT(*) FROM coexistence.broadcasts WHERE template_id = t.id)::int AS "broadcastCount",
              (SELECT COUNT(*) FROM coexistence.broadcast_logs bl
                JOIN coexistence.broadcasts b ON b.id = bl.broadcast_id
               WHERE b.template_id = t.id AND bl.action = 'BROADCAST')::int AS "sendCount"
       FROM coexistence.message_templates t
       LEFT JOIN coexistence.whatsapp_accounts wa ON wa.id = t.whatsapp_account_id
       ${whereSql}
       ORDER BY t.updated_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('[templates] list error:', err.message);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// GET /templates/:id — single template
router.get('/templates/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.name, t.category, t.language, t.header_type, t.header_text, t.media_handle,
              t.header_media_library_id, t.body, t.footer,
              t.buttons, t.samples, t.security_recommendation, t.code_expiry_minutes,
              t.allow_category_change, t.status, t.meta_template_id, t.submitted_at,
              t.quality_score, t.rejection_reason, t.previous_category, t.last_synced_at,
              t.template_group_key,
              t.created_at, t.updated_at,
              t.whatsapp_account_id AS "whatsappAccountId",
              wa.display_name AS "whatsappAccountName",
              wa.display_phone_number AS "whatsappAccountPhone",
              (SELECT COUNT(*) FROM coexistence.broadcasts WHERE template_id = t.id)::int AS "broadcastCount",
              (SELECT COUNT(*) FROM coexistence.broadcast_logs bl
                JOIN coexistence.broadcasts b ON b.id = bl.broadcast_id
               WHERE b.template_id = t.id AND bl.action = 'BROADCAST')::int AS "sendCount"
       FROM coexistence.message_templates t
       LEFT JOIN coexistence.whatsapp_accounts wa ON wa.id = t.whatsapp_account_id
       WHERE t.id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Template not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[templates] GET /:id error:', err.message);
    res.status(400).json({ error: 'Invalid template id' });
  }
});

// POST /templates — create
router.post('/templates', requirePermission('template-builder'), async (req, res) => {
  const data = req.body;
  const errors = runValidation(data);
  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ error: 'Validation failed', errors });
  }

  // Meta requires unique (name, language) per WABA. Pre-check locally to
  // give a friendly error before submission fails downstream.
  if (data.whatsappAccountId) {
    const { rows: dup } = await pool.query(
      `SELECT id FROM coexistence.message_templates
        WHERE whatsapp_account_id = $1
          AND lower(name) = lower($2)
          AND language = $3
        LIMIT 1`,
      [data.whatsappAccountId, data.name, data.language]
    );
    if (dup.length > 0) {
      return res.status(409).json({
        error: `A template with name "${data.name}" in language "${data.language}" already exists on this WhatsApp Account. Choose a different name or language.`,
        existingId: dup[0].id,
      });
    }
  }

  const { rows } = await pool.query(
    `INSERT INTO coexistence.message_templates
     (name, category, language, header_type, header_text, media_handle, body, footer,
      buttons, samples, security_recommendation, code_expiry_minutes, allow_category_change, status,
      whatsapp_account_id, template_group_key, header_media_library_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *`,
    [
      data.name, data.category, data.language, data.header_type || 'NONE',
      data.header_text || null, data.media_handle || null, data.body,
      data.footer || null, JSON.stringify(data.buttons || []), JSON.stringify(data.samples || {}),
      data.security_recommendation || false, data.code_expiry_minutes || null,
      data.allow_category_change !== false, 'DRAFT',
      data.whatsappAccountId || null,
      String(data.name || '').toLowerCase(),
      data.header_media_library_id || null,
    ]
  );
  res.status(201).json(rows[0]);
});

// PUT /templates/:id — update template. Behavior depends on current status:
//   DRAFT / REJECTED  → local-only edit, status stays DRAFT
//   APPROVED / PAUSED → calls Meta edit API, status flips to SUBMITTED for re-review
//   SUBMITTED         → 409 (already under review; wait for outcome)
//   DISABLED          → 409 (must duplicate + recreate per Meta policy)
router.put('/templates/:id', requirePermission('template-builder'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows: existing } = await client.query(
      'SELECT * FROM coexistence.message_templates WHERE id = $1', [req.params.id]
    );
    if (existing.length === 0) return res.status(404).json({ error: 'Template not found' });
    const tpl = existing[0];

    if (tpl.status === 'SUBMITTED') {
      return res.status(409).json({ error: 'Template is under Meta review — wait for approval/rejection before editing' });
    }
    if (tpl.status === 'DISABLED') {
      return res.status(409).json({ error: 'DISABLED templates cannot be edited — duplicate and resubmit instead' });
    }

    const data = req.body;
    const errors = runValidation(data);
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ error: 'Validation failed', errors });
    }

    // Meta does not allow renaming or language changes after creation
    const isApprovedEdit = ['APPROVED', 'PAUSED'].includes(tpl.status);
    if (isApprovedEdit) {
      if (data.name && data.name !== tpl.name) {
        return res.status(400).json({ error: 'Cannot rename an APPROVED template — duplicate it instead' });
      }
      if (data.language && data.language !== tpl.language) {
        return res.status(400).json({ error: 'Cannot change language on an APPROVED template — add a translation instead' });
      }
    }

    await client.query('BEGIN');

    let newStatus = 'DRAFT';
    let metaResponse = null;

    if (isApprovedEdit) {
      // Real Meta edit — needs the linked WhatsApp Account
      if (!tpl.whatsapp_account_id || !tpl.meta_template_id) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Template missing account link or Meta ID — cannot edit at Meta' });
      }
      const account = await getAccountWithToken(tpl.whatsapp_account_id);
      if (!account?.accessToken) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Linked WhatsApp Account has no access token' });
      }

      // Build the payload Meta expects for an edit (components + optional category swap)
      const fullPayload = buildPayload({ ...tpl, ...data, buttons: data.buttons || [] });
      const editPayload = { components: fullPayload.components };
      if (data.category && data.category !== tpl.category && data.category !== 'AUTHENTICATION') {
        editPayload.category = data.category;
      }

      try {
        metaResponse = await metaEditTemplate(tpl.meta_template_id, account.accessToken, editPayload);
        await markAccountHealth(account.id, 'healthy');
        newStatus = 'SUBMITTED'; // Meta re-reviews edited templates
      } catch (err) {
        await client.query('ROLLBACK');
        const isAuth = err.status === 401 || err.metaError?.code === 190;
        await markAccountHealth(account.id, isAuth ? 'invalid_token' : 'unknown_error', err.message).catch(() => {});
        return res.status(err.status === 401 ? 401 : 400).json({
          error: err.metaError?.message || 'Meta API error',
          metaCode: err.metaError?.code,
          metaErrorSubcode: err.metaError?.error_subcode,
          metaErrorData: err.metaError?.error_data,
        });
      }
    }

    const { rows } = await client.query(
      `UPDATE coexistence.message_templates SET
        name = $1::text, category = $2, language = $3, header_type = $4, header_text = $5,
        media_handle = $6, body = $7, footer = $8, buttons = $9, samples = $10,
        security_recommendation = $11, code_expiry_minutes = $12, allow_category_change = $13,
        whatsapp_account_id = $14,
        template_group_key = lower($1::text),
        status = $15,
        meta_template_id = CASE WHEN $16::boolean THEN meta_template_id ELSE NULL END,
        submitted_at = CASE WHEN $16::boolean THEN NOW() ELSE NULL END,
        header_media_library_id = $18,
        updated_at = NOW()
       WHERE id = $17
       RETURNING *`,
      [
        data.name || tpl.name, data.category, data.language || tpl.language,
        data.header_type || 'NONE', data.header_text || null, data.media_handle || null,
        data.body, data.footer || null,
        JSON.stringify(data.buttons || []), JSON.stringify(data.samples || {}),
        data.security_recommendation || false, data.code_expiry_minutes || null,
        data.allow_category_change !== false,
        data.whatsappAccountId || tpl.whatsapp_account_id,
        newStatus,
        isApprovedEdit,
        req.params.id,
        data.header_media_library_id || null,
      ]
    );
    await client.query('COMMIT');
    res.json({ ...rows[0], metaResponse });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[templates] PUT error:', err.message);
    res.status(500).json({ error: 'Failed to update template' });
  } finally {
    client.release();
  }
});

// DELETE /templates/:id — removes from local DB AND from Meta if it was submitted
router.delete('/templates/:id', requirePermission('template-builder'), async (req, res) => {
  try {
    const { rows: tplRows } = await pool.query(
      'SELECT * FROM coexistence.message_templates WHERE id = $1', [req.params.id]
    );
    if (tplRows.length === 0) return res.status(404).json({ error: 'Template not found' });
    const tpl = tplRows[0];

    // If template was submitted to Meta, delete there too (best-effort — local
    // delete still proceeds even if Meta fails, since user explicitly chose delete)
    let metaDeleted = false, metaError = null;
    if (tpl.meta_template_id && tpl.whatsapp_account_id) {
      const account = await getAccountWithToken(tpl.whatsapp_account_id);
      if (account?.accessToken) {
        try {
          await metaDeleteTemplate(account.wabaId, account.accessToken, tpl.name);
          metaDeleted = true;
        } catch (err) {
          metaError = err.message;
          console.warn(`[templates] Meta delete failed for ${tpl.name}: ${err.message}`);
        }
      }
    }
    await pool.query('DELETE FROM coexistence.message_templates WHERE id = $1', [req.params.id]);
    res.json({ ok: true, metaDeleted, metaError });
  } catch (err) {
    console.error('[templates] DELETE error:', err.message);
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

// POST /templates/:id/submit
/**
 * POST /templates/:id/submit — real Meta submission via
 * POST /v21.0/{waba_id}/message_templates. Uses the WhatsApp Account
 * linked to this template (template.whatsapp_account_id). Meta returns the
 * template's review status (often PENDING; sometimes auto-APPROVED for simple
 * AUTHENTICATION templates).
 */
const { submitTemplate } = require('../integrations/metaTemplates');
const { getAccountWithToken } = require('./whatsappAccounts');
const { markAccountHealth } = require('../services/accountHealth');

router.post('/templates/:id/submit', requirePermission('template-builder'), async (req, res) => {
  try {
    const { rows: tplRows } = await pool.query(
      'SELECT * FROM coexistence.message_templates WHERE id = $1',
      [req.params.id]
    );
    if (tplRows.length === 0) return res.status(404).json({ error: 'Template not found' });
    const tpl = tplRows[0];
    if (!tpl.whatsapp_account_id) {
      return res.status(400).json({ error: 'Template has no WhatsApp Account assigned. Edit the template and pick an account first.' });
    }

    const account = await getAccountWithToken(tpl.whatsapp_account_id);
    if (!account) return res.status(400).json({ error: 'Linked WhatsApp Account not found' });
    if (!account.accessToken) return res.status(400).json({ error: 'Account has no access token' });

    const payload = buildPayload(tpl);

    let metaResponse;
    try {
      metaResponse = await submitTemplate(account.wabaId, account.accessToken, payload);
      await markAccountHealth(account.id, 'healthy');
    } catch (err) {
      // 401/190 = expired/invalid token — flag account as unhealthy
      const isAuth = err.status === 401 || err.metaError?.code === 190;
      await markAccountHealth(account.id, isAuth ? 'invalid_token' : 'unknown_error', err.message);
      // Prefer Meta's human-readable reason (error_user_title/msg) over the
      // generic "Invalid parameter" so users see e.g. "Parameters words ratio
      // exceeds limit — reduce variables or lengthen the message".
      const mErr = err.metaError || {};
      const human = mErr.error_user_title
        ? `${mErr.error_user_title}${mErr.error_user_msg ? ' — ' + mErr.error_user_msg : ''}`
        : (mErr.error_user_msg || mErr.message || err.message || 'Meta submission failed');
      return res.status(err.status === 401 ? 401 : 400).json({
        error: human,
        metaCode: err.metaError?.code,
        metaErrorSubcode: err.metaError?.error_subcode,
        metaErrorData: err.metaError?.error_data,
      });
    }

    // Map Meta status → our local status
    const metaStatus = (metaResponse.status || 'PENDING').toUpperCase();
    const localStatus = metaStatus === 'APPROVED' ? 'APPROVED'
      : metaStatus === 'REJECTED' ? 'REJECTED'
      : 'SUBMITTED';

    const { rows } = await pool.query(
      `UPDATE coexistence.message_templates
         SET status = $1, meta_template_id = $2, submitted_at = NOW(), updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [localStatus, metaResponse.id || null, req.params.id]
    );
    res.json({ ...rows[0], metaResponse });
  } catch (err) {
    console.error('[templates] submit error:', err.message);
    res.status(500).json({ error: 'Failed to submit template' });
  }
});

// Note: /templates/:id/approve and /:id/reject were removed — they used to
// just flip local DB state without calling Meta, which was misleading. Use
// /:id/sync (single template) or /sync (all) to pull real status from Meta.

const { listTemplates: metaListTemplates, deleteTemplate: metaDeleteTemplate, editTemplate: metaEditTemplate } = require('../integrations/metaTemplates');

/**
 * Internal helper — sync templates for one WABA from Meta and upsert into
 * local DB. Returns { updated, total } counts.
 */
// Reverse of buildPayload: turn Meta's components[] back into our local fields
// so a template that exists on Meta (e.g. the pre-approved hello_world, or one
// created directly in Business Manager) can be imported and used in the app.
function parseMetaComponents(components = []) {
  const out = {
    header_type: 'NONE', header_text: null, body: '', footer: null,
    buttons: [], samples: {}, security_recommendation: false, code_expiry_minutes: null,
  };
  const varsIn = (s) => (String(s || '').match(/\{\{\s*(\w+)\s*\}\}/g) || []).map(v => v.replace(/[{}\s]/g, ''));
  for (const c of components || []) {
    const type = String(c.type || '').toUpperCase();
    if (type === 'HEADER') {
      out.header_type = String(c.format || 'TEXT').toUpperCase();
      if (out.header_type === 'TEXT') {
        out.header_text = c.text || null;
        const hv = varsIn(c.text);
        if (hv[0] && c.example?.header_text?.[0] != null) out.samples[hv[0]] = c.example.header_text[0];
      }
      // Media headers (IMAGE/VIDEO/DOCUMENT): the Meta handle isn't recoverable
      // from a list, so header_type is set but no media is attached.
    } else if (type === 'BODY') {
      out.body = c.text || '';
      if (c.add_security_recommendation) out.security_recommendation = true;
      const bv = varsIn(c.text);
      const ex = c.example?.body_text?.[0] || [];
      bv.forEach((v, i) => { if (ex[i] != null) out.samples[v] = ex[i]; });
    } else if (type === 'FOOTER') {
      if (c.code_expiration_minutes != null) out.code_expiry_minutes = c.code_expiration_minutes;
      else out.footer = c.text || null;
    } else if (type === 'BUTTONS') {
      out.buttons = (c.buttons || []).map(b => {
        const bt = String(b.type || '').toUpperCase();
        if (bt === 'URL') return { type: 'URL', text: b.text, value: b.url, urlSample: b.example?.[0] || '' };
        if (bt === 'PHONE_NUMBER') return { type: 'PHONE_NUMBER', text: b.text, value: b.phone_number };
        if (bt === 'COPY_CODE') return { type: 'COPY_CODE', value: (b.example && b.example[0]) || '' };
        if (bt === 'OTP') return { type: 'OTP', text: b.text, otpType: b.otp_type, packageName: b.package_name, signatureHash: b.signature_hash };
        return { type: 'QUICK_REPLY', text: b.text };
      });
    }
  }
  return out;
}

async function syncAccountTemplates(account) {
  const remote = await metaListTemplates(account.wabaId, account.accessToken, {
    fields: 'name,language,status,category,previous_category,quality_score,rejected_reason,id,components',
  });
  let updated = 0;
  let imported = 0;
  for (const r of remote) {
    const status = (r.status || 'PENDING').toUpperCase();
    const localStatus = status === 'PENDING' ? 'SUBMITTED' : status; // PAUSED, DISABLED, APPROVED, REJECTED pass through
    const qs = typeof r.quality_score === 'object' ? r.quality_score?.score : r.quality_score;
    const result = await pool.query(
      `UPDATE coexistence.message_templates
          SET status = $1,
              quality_score = $2,
              rejection_reason = $3,
              previous_category = COALESCE($4, previous_category),
              category = COALESCE($5, category),
              meta_template_id = COALESCE(meta_template_id, $6),
              last_synced_at = NOW(),
              updated_at = NOW()
        WHERE whatsapp_account_id = $7
          AND lower(name) = lower($8)
          AND language = $9
        RETURNING id`,
      [
        localStatus,
        qs || null,
        r.rejected_reason || null,
        r.previous_category || null,
        r.category ? String(r.category).toUpperCase() : null,
        r.id || null,
        account.id,
        r.name,
        r.language,
      ]
    );
    if (result.rowCount > 0) {
      updated++;
    } else {
      // Exists on Meta but not locally → import it so the app can use it
      // (e.g. the pre-approved hello_world, or templates made in Business Manager).
      const p = parseMetaComponents(r.components);
      await pool.query(
        `INSERT INTO coexistence.message_templates
           (name, category, language, header_type, header_text, body, footer, buttons, samples,
            security_recommendation, code_expiry_minutes, status, meta_template_id,
            whatsapp_account_id, template_group_key, quality_score, previous_category,
            last_synced_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW(),NOW())`,
        [
          r.name,
          r.category ? String(r.category).toUpperCase() : 'UTILITY',
          r.language,
          p.header_type,
          p.header_text,
          p.body,
          p.footer,
          JSON.stringify(p.buttons || []),
          JSON.stringify(p.samples || {}),
          p.security_recommendation || false,
          p.code_expiry_minutes,
          localStatus,
          r.id || null,
          account.id,
          String(r.name || '').toLowerCase(),
          qs || null,
          r.previous_category || null,
        ]
      );
      imported++;
    }
  }
  return { updated, imported, total: remote.length };
}

/**
 * POST /templates/:id/sync — refresh one template's Meta-side status.
 * Looks up the linked account, lists Meta's templates, finds the match by
 * (name, language), updates local row.
 */
router.post('/templates/:id/sync', requirePermission('template-builder'), async (req, res) => {
  try {
    const { rows: tplRows } = await pool.query(
      'SELECT * FROM coexistence.message_templates WHERE id = $1', [req.params.id]
    );
    if (tplRows.length === 0) return res.status(404).json({ error: 'Template not found' });
    const tpl = tplRows[0];
    if (!tpl.whatsapp_account_id) return res.status(400).json({ error: 'Template has no WhatsApp Account assigned' });

    const account = await getAccountWithToken(tpl.whatsapp_account_id);
    if (!account) return res.status(400).json({ error: 'Account not found' });
    try {
      await syncAccountTemplates(account);
      await markAccountHealth(account.id, 'healthy');
    } catch (err) {
      const { classifyMetaError } = require('../services/accountHealth');
      await markAccountHealth(account.id, classifyMetaError(err), err.message);
      return res.status(err.status === 401 ? 401 : 400).json({ error: err.message });
    }
    const { rows: fresh } = await pool.query(
      `SELECT * FROM coexistence.message_templates WHERE id = $1`, [req.params.id]
    );
    res.json(fresh[0]);
  } catch (err) {
    console.error('[templates] sync error:', err.message);
    res.status(500).json({ error: 'Failed to sync from Meta' });
  }
});

/**
 * Sync every active account's templates from Meta. Shared by the manual
 * "Refresh All" button (POST /templates/sync-all) and the periodic auto-sync
 * cron in index.js (Meta does not push us approval status — we must poll).
 */
async function syncAllAccountTemplates() {
  const { rows: accs } = await pool.query(
    `SELECT * FROM coexistence.whatsapp_accounts WHERE is_active = TRUE`
  );
  let totalUpdated = 0, totalImported = 0, totalRemote = 0;
  for (const r of accs) {
    const account = await getAccountWithToken(r.id);
    if (!account?.accessToken) continue;
    try {
      const result = await syncAccountTemplates(account);
      totalUpdated += result.updated;
      totalImported += result.imported || 0;
      totalRemote += result.total;
      await markAccountHealth(account.id, 'healthy');
    } catch (err) {
      const { classifyMetaError } = require('../services/accountHealth');
      await markAccountHealth(account.id, classifyMetaError(err), err.message);
    }
  }
  return { accountsScanned: accs.length, totalUpdated, totalImported, totalRemote };
}

/**
 * POST /templates/sync-all — sync every account's templates. Used by the
 * "Refresh All" button in the list view + the periodic auto-sync cron.
 */
router.post('/templates/sync-all', requirePermission('template-builder'), async (req, res) => {
  try {
    const result = await syncAllAccountTemplates();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[templates] sync-all error:', err.message);
    res.status(500).json({ error: 'Failed to sync templates' });
  }
});

/**
 * POST /templates/:id/duplicate — create a DRAFT clone with " (copy)" name suffix.
 */
router.post('/templates/:id/duplicate', requirePermission('template-builder'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `INSERT INTO coexistence.message_templates
        (name, category, language, header_type, header_text, media_handle, body, footer,
         buttons, samples, security_recommendation, code_expiry_minutes, allow_category_change,
         status, whatsapp_account_id, template_group_key)
       SELECT name || '_copy_' || EXTRACT(EPOCH FROM NOW())::int,
              category, language, header_type, header_text, media_handle, body, footer,
              buttons, samples, security_recommendation, code_expiry_minutes, allow_category_change,
              'DRAFT', whatsapp_account_id, NULL
         FROM coexistence.message_templates WHERE id = $1
       RETURNING *`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Template not found' });
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[templates] duplicate error:', err.message);
    res.status(500).json({ error: 'Failed to duplicate template' });
  }
});

/**
 * POST /templates/bulk-submit — submit multiple DRAFT templates in one call.
 * Body: { ids: [1, 2, 3] }. Returns per-id outcome.
 */
router.post('/templates/bulk-submit', requirePermission('template-builder'), async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids required' });
    if (ids.length > 50) return res.status(400).json({ error: 'Too many templates (max 50 per bulk submit)' });
    const results = [];
    for (const id of ids) {
      try {
        const fakeReq = { params: { id }, body: {} };
        const fakeRes = { _status: 200, _body: null,
          status(c) { this._status = c; return this; },
          json(b) { this._body = b; return this; },
        };
        // Re-invoke the existing /:id/submit handler logic inline by calling it
        await new Promise((resolve) => {
          submitOneInline(id).then(out => {
            results.push({ id, ...out });
            resolve();
          }).catch(err => {
            results.push({ id, ok: false, error: err.message });
            resolve();
          });
        });
      } catch (err) {
        results.push({ id, ok: false, error: err.message });
      }
    }
    res.json({ results, succeeded: results.filter(r => r.ok).length, total: results.length });
  } catch (err) {
    console.error('[templates] bulk-submit error:', err.message);
    res.status(500).json({ error: 'Bulk submit failed' });
  }
});

// Internal: shared submit-one logic used by /submit and /bulk-submit
async function submitOneInline(id) {
  const { rows: tplRows } = await pool.query('SELECT * FROM coexistence.message_templates WHERE id = $1', [id]);
  if (tplRows.length === 0) return { ok: false, error: 'Template not found' };
  const tpl = tplRows[0];
  if (!tpl.whatsapp_account_id) return { ok: false, error: 'No WhatsApp Account assigned' };
  const account = await getAccountWithToken(tpl.whatsapp_account_id);
  if (!account?.accessToken) return { ok: false, error: 'Account has no token' };

  const payload = buildPayload(tpl);
  try {
    const metaResponse = await submitTemplate(account.wabaId, account.accessToken, payload);
    await markAccountHealth(account.id, 'healthy');
    const metaStatus = (metaResponse.status || 'PENDING').toUpperCase();
    const localStatus = metaStatus === 'APPROVED' ? 'APPROVED'
      : metaStatus === 'REJECTED' ? 'REJECTED' : 'SUBMITTED';
    await pool.query(
      `UPDATE coexistence.message_templates
         SET status = $1, meta_template_id = $2, submitted_at = NOW(), updated_at = NOW()
       WHERE id = $3`,
      [localStatus, metaResponse.id || null, id]
    );
    return { ok: true, status: localStatus, metaId: metaResponse.id };
  } catch (err) {
    const { classifyMetaError } = require('../services/accountHealth');
    await markAccountHealth(account.id, classifyMetaError(err), err.message);
    return { ok: false, error: err.metaError?.message || err.message };
  }
}

// (export consolidated at the bottom of this file)

// GET /templates/:id/payload — get Meta API payload
router.get('/templates/:id/payload', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT name, category, language, header_type, header_text, media_handle, body, footer,
              buttons, samples, security_recommendation, code_expiry_minutes, allow_category_change
       FROM coexistence.message_templates WHERE id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Template not found' });
    const payload = buildPayload(rows[0]);
    res.json(payload);
  } catch (err) {
    console.error('[templates] payload error:', err.message);
    res.status(500).json({ error: 'Failed to load payload' });
  }
});

/**
 * POST /templates/:id/test-send
 * Body: { to: '919xxx', sampleValues?: { '1': 'John', '2': 'ORD-123' } }
 * Sends the template via the WhatsApp account linked to this template.
 */
const { resolveAccount, insertPendingRow } = require('../services/messageSender');
const { enqueueSend } = require('../queue/sendQueue');

router.post('/templates/:id/test-send', requirePermission('template-builder'), async (req, res) => {
  try {
    const { to, sampleValues = {} } = req.body || {};
    if (!to) return res.status(400).json({ error: 'to (recipient phone) required' });

    const { rows } = await pool.query(
      `SELECT id, name, language, body, whatsapp_account_id FROM coexistence.message_templates WHERE id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Template not found' });
    const tpl = rows[0];
    if (!tpl.whatsapp_account_id) return res.status(400).json({ error: 'Template has no WhatsApp account assigned' });

    const { account, error } = await resolveAccount({ accountId: tpl.whatsapp_account_id });
    if (error) return res.status(400).json({ error });

    // Build components from sampleValues (sorted numerically by var index)
    const keys = Object.keys(sampleValues).sort((a, b) => +a - +b);
    const components = keys.length > 0
      ? [{ type: 'body', parameters: keys.map(k => ({ type: 'text', text: String(sampleValues[k] || ' ') })) }]
      : [];

    const localId = await insertPendingRow({
      account, toNumber: to, messageType: 'template', messageBody: tpl.body || `Template: ${tpl.name}`,
    });
    await enqueueSend({
      kind: 'template',
      accountId: account.id,
      to: String(to).replace(/\D/g, ''),
      localMessageId: localId,
      payload: { name: tpl.name, languageCode: tpl.language || 'en', components },
    });

    res.status(202).json({ ok: true, messageId: localId, status: 'sending' });
  } catch (err) {
    console.error('[templates] test-send error:', err.message);
    res.status(500).json({ error: 'Failed to enqueue test send' });
  }
});

/**
 * POST /templates/upload-media-handle (multipart)
 * Fields: accountId, file
 * Performs Meta's Resumable Upload (2-step) to obtain a `media_handle` that
 * can be pasted into a template's header.example. Returns { handle }.
 */
const multer = require('multer');
const { uploadTemplateMediaHandle } = require('../integrations/metaResumableUpload');
const tplMediaUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.post('/templates/upload-media-handle', requirePermission('template-builder'), tplMediaUpload.single('file'), async (req, res) => {
  try {
    const { accountId } = req.body || {};
    if (!accountId) return res.status(400).json({ error: 'accountId required' });
    if (!req.file) return res.status(400).json({ error: 'file required' });

    const headerMime = canonicalizeMime(req.file.mimetype, req.file.originalname);
    if (!isTemplateHeaderMime(headerMime)) {
      return res.status(400).json({ error: `Unsupported file type "${req.file.mimetype || 'unknown'}" for a template header. ${TEMPLATE_TYPES_MSG}` });
    }

    const { rows } = await pool.query(
      'SELECT * FROM coexistence.whatsapp_accounts WHERE id = $1',
      [accountId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'WhatsApp account not found' });
    const acc = rows[0];
    if (!acc.meta_app_id) {
      return res.status(400).json({ error: 'WhatsApp account is missing meta_app_id — add it in Settings → WhatsApp Accounts' });
    }
    const { decrypt } = require('../util/crypto');
    const accessToken = decrypt(acc.access_token_encrypted);
    if (!accessToken) return res.status(400).json({ error: 'Account has no access token' });

    try {
      const handle = await uploadTemplateMediaHandle({
        appId: acc.meta_app_id, accessToken,
        buffer: req.file.buffer, mimeType: headerMime,
      });
      await markAccountHealth(acc.id, 'healthy');
      res.json({ handle, mimeType: headerMime, size: req.file.size });
    } catch (err) {
      const { classifyMetaError } = require('../services/accountHealth');
      await markAccountHealth(acc.id, classifyMetaError(err), err.message);
      return res.status(err.status === 401 ? 401 : 400).json({ error: err.message, metaCode: err.metaError?.code });
    }
  } catch (err) {
    console.error('[templates] upload-media-handle error:', err.message);
    res.status(500).json({ error: 'Failed to upload template media' });
  }
});

/**
 * POST /templates/upload-media-handle-from-library
 * Body: { accountId, mediaLibraryId }
 *
 * Same outcome as /templates/upload-media-handle, but pulls the source bytes
 * from the Media Library (Postgres storage) instead of an inline multipart upload.
 * The template `header_handle` is single-use at submit time, so we don't
 * persist anything per-WABA for templates — this is purely a convenience
 * that lets users build templates from previously uploaded library assets.
 */
router.post('/templates/upload-media-handle-from-library', requirePermission('template-builder'), async (req, res) => {
  try {
    const { accountId, mediaLibraryId } = req.body || {};
    if (!accountId || !mediaLibraryId) {
      return res.status(400).json({ error: 'accountId and mediaLibraryId required' });
    }

    const { rows: accRows } = await pool.query(
      'SELECT * FROM coexistence.whatsapp_accounts WHERE id = $1',
      [accountId]
    );
    if (!accRows.length) return res.status(404).json({ error: 'WhatsApp account not found' });
    const acc = accRows[0];
    if (!acc.meta_app_id) {
      return res.status(400).json({ error: 'WhatsApp account is missing meta_app_id — add it in Settings → WhatsApp Accounts' });
    }

    const { rows: mRows } = await pool.query(
      `SELECT * FROM coexistence.media_library WHERE id = $1 AND deleted_at IS NULL`,
      [mediaLibraryId]
    );
    if (!mRows.length) return res.status(404).json({ error: 'Media not found in library' });
    const media = mRows[0];

    const { decrypt } = require('../util/crypto');
    const accessToken = decrypt(acc.access_token_encrypted);
    if (!accessToken) return res.status(400).json({ error: 'Account has no access token' });

    const headerMime = canonicalizeMime(media.mime_type, media.original_name);
    if (!isTemplateHeaderMime(headerMime)) {
      return res.status(400).json({ error: `"${media.original_name || 'This file'}" (${media.mime_type || 'unknown'}) can't be a template header. ${TEMPLATE_TYPES_MSG}` });
    }

    const storage = require('../util/pgStorage');
    let buffer;
    try {
      buffer = await storage.getObjectBuffer(media.storage_key);
    } catch (err) {
      return res.status(502).json({ error: `Failed to read media from storage: ${err.message}` });
    }

    try {
      const handle = await uploadTemplateMediaHandle({
        appId: acc.meta_app_id, accessToken,
        buffer, mimeType: headerMime,
      });
      await markAccountHealth(acc.id, 'healthy');
      res.json({
        handle,
        mimeType: headerMime,
        size: Number(media.size_bytes),
        name: media.name,
        originalName: media.original_name,
        mediaLibraryId: Number(media.id),
      });
    } catch (err) {
      const { classifyMetaError } = require('../services/accountHealth');
      await markAccountHealth(acc.id, classifyMetaError(err), err.message);
      return res.status(err.status === 401 ? 401 : 400).json({ error: err.message, metaCode: err.metaError?.code });
    }
  } catch (err) {
    console.error('[templates] upload-media-handle-from-library error:', err.message);
    res.status(500).json({ error: 'Failed to upload template media from library' });
  }
});

module.exports = { router, syncAccountTemplates, syncAllAccountTemplates };
