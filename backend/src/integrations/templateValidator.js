// Template send validator.
//
// Guards against the two Meta send errors that silently burn template sends:
//   #132000 -> parameter count mismatch (body / header text / URL button)
//   #132012 -> format mismatch (media header missing, or media sent on a
//              non-media header)
//
// It validates the OUTGOING `components` payload (Meta send format) against the
// AUTHORITATIVE template spec, in this authority order:
//   1. Live Graph API spec (cached per WABA, short TTL)
//   2. Locally synced coexistence.message_templates row (fallback if Meta
//      cannot be reached -- e.g. transient network error)
//   3. If NEITHER is available -> hard block (fail-closed; never let an
//      unverifiable template reach Meta).
//
// Pure helpers are exported so they can be unit-tested without network/DB.

const pool = require('../db');
const { listTemplates } = require('./metaTemplates');

const SPEC_TTL_MS = 5 * 60 * 1000;
const _cache = new Map(); // wabaId -> { at, byKey: Map('name::lang' -> spec) }

function distinctVars(text) {
  const s = new Set();
  for (const m of String(text || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)) s.add(m[1]);
  return s.size;
}

// Structural requirements from a Meta spec (components[] as Graph API returns).
function requirementsFromMetaSpec(spec) {
  const req = { bodyParams: 0, headerFormat: 'NONE', headerNeedsMedia: false, headerTextParams: 0, urlButtons: [] };
  for (const c of (spec && spec.components) || []) {
    const type = String(c.type || '').toUpperCase();
    if (type === 'BODY') {
      req.bodyParams = distinctVars(c.text);
    } else if (type === 'HEADER') {
      req.headerFormat = String(c.format || 'TEXT').toUpperCase();
      if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(req.headerFormat)) req.headerNeedsMedia = true;
      else if (req.headerFormat === 'TEXT') req.headerTextParams = distinctVars(c.text);
    } else if (type === 'BUTTONS') {
      (c.buttons || []).forEach((b, i) => {
        if (String(b.type || '').toUpperCase() === 'URL' && distinctVars(b.url) > 0) {
          req.urlButtons.push({ index: i, params: distinctVars(b.url) });
        }
      });
    }
  }
  return req;
}

// Same, derived from a locally synced message_templates row (fallback authority).
function requirementsFromLocalRow(row) {
  const req = { bodyParams: distinctVars(row.body), headerFormat: String(row.header_type || 'NONE').toUpperCase(), headerNeedsMedia: false, headerTextParams: 0, urlButtons: [] };
  if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(req.headerFormat)) req.headerNeedsMedia = true;
  else if (req.headerFormat === 'TEXT') req.headerTextParams = distinctVars(row.header_text);
  let btns = row.buttons;
  if (typeof btns === 'string') { try { btns = JSON.parse(btns); } catch { btns = []; } }
  (btns || []).forEach((b, i) => {
    if (String(b.type || '').toUpperCase() === 'URL') {
      const url = b.value || b.url || '';
      if (distinctVars(url) > 0) req.urlButtons.push({ index: i, params: distinctVars(url) });
    }
  });
  return req;
}

// Inspect the outgoing components payload (Meta send format) -> provided shape.
function shapeOfComponents(components) {
  const out = { bodyParams: 0, headerParams: 0, headerMedia: false, urlButtons: [] };
  for (const c of components || []) {
    const type = String(c.type || '').toLowerCase();
    if (type === 'body') {
      out.bodyParams = (c.parameters || []).length;
    } else if (type === 'header') {
      out.headerParams = (c.parameters || []).length;
      out.headerMedia = (c.parameters || []).some(p => ['image', 'video', 'document'].includes(String(p.type || '').toLowerCase()));
    } else if (type === 'button') {
      if (String(c.sub_type || '').toLowerCase() === 'url') out.urlButtons.push({ index: Number(c.index), params: (c.parameters || []).length });
    }
  }
  return out;
}

// Compare requirements vs outgoing components. Returns { valid, errors[] }.
function validateAgainstRequirements(req, components) {
  const errors = [];
  const got = shapeOfComponents(components);
  if (got.bodyParams !== req.bodyParams) {
    errors.push(`body params: template expects ${req.bodyParams}, got ${got.bodyParams} (#132000)`);
  }
  if (req.headerNeedsMedia && !got.headerMedia) {
    errors.push(`header ${req.headerFormat} requires media but none was provided (#132012)`);
  }
  if (!req.headerNeedsMedia && got.headerMedia) {
    errors.push(`header is ${req.headerFormat} but a media header param was provided (#132012)`);
  }
  if (req.headerFormat === 'TEXT' && (req.headerTextParams > 0 || got.headerParams > 0) && req.headerTextParams !== got.headerParams) {
    errors.push(`header text params: template expects ${req.headerTextParams}, got ${got.headerParams} (#132000)`);
  }
  for (const ub of req.urlButtons) {
    const provided = got.urlButtons.find(g => g.index === ub.index);
    if (!provided) errors.push(`url button index ${ub.index} requires ${ub.params} param(s) but none was provided (#132000)`);
    else if (provided.params !== ub.params) errors.push(`url button index ${ub.index}: expects ${ub.params}, got ${provided.params} (#132000)`);
  }
  return { valid: errors.length === 0, errors, requirements: req };
}

async function fetchMetaSpecs(account) {
  const key = String(account.wabaId);
  const now = Date.now();
  const cached = _cache.get(key);
  if (cached && (now - cached.at) < SPEC_TTL_MS) return cached.byKey;
  const list = await listTemplates(account.wabaId, account.accessToken, { fields: 'name,language,status,components,id', limit: 200 });
  const byKey = new Map();
  for (const t of list) byKey.set(`${t.name}::${t.language}`, t);
  _cache.set(key, { at: now, byKey });
  return byKey;
}

async function getRequirements(account, name, language) {
  try {
    const byKey = await fetchMetaSpecs(account);
    let spec = byKey.get(`${name}::${language}`);
    if (!spec) { for (const [, v] of byKey) if (v.name === name) { spec = v; break; } }
    if (spec) return { source: 'meta', req: requirementsFromMetaSpec(spec) };
  } catch (err) {
    console.warn('[tpl-validator] Meta fetch failed, falling back to local synced row:', err.message);
  }
  try {
    const { rows } = await pool.query(
      `SELECT name, header_type, header_text, body, buttons
         FROM coexistence.message_templates
        WHERE name = $1 AND status = 'APPROVED'
        ORDER BY updated_at DESC LIMIT 1`,
      [name]
    );
    if (rows[0]) return { source: 'local', req: requirementsFromLocalRow(rows[0]) };
  } catch (err) {
    console.warn('[tpl-validator] local row fetch failed:', err.message);
  }
  return { source: 'none', req: null };
}

// Main entry. Returns { valid, errors[], source, requirements }.
async function validateTemplateSend(account, name, language, components) {
  const { source, req } = await getRequirements(account, name, language);
  if (!req) {
    return { valid: false, source, requirements: null, errors: [`no template spec available for "${name}" (neither Meta nor local synced row) -- blocking to avoid garbage to Meta`] };
  }
  const r = validateAgainstRequirements(req, components);
  return { valid: r.valid, errors: r.errors, requirements: r.requirements, source };
}

module.exports = {
  validateTemplateSend,
  validateAgainstRequirements,
  requirementsFromMetaSpec,
  requirementsFromLocalRow,
  shapeOfComponents,
  distinctVars,
};
