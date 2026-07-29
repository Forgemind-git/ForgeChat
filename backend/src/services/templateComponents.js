// Build the Meta `components` array for sending an approved WhatsApp template.
//
// This is the single source of truth for both the broadcast (bulk) path and the
// template test-send path. It is complete across every component type Meta can
// require a runtime parameter for:
//
//   - Media headers (IMAGE/VIDEO/DOCUMENT) → header media id
//   - TEXT headers containing a {{n}} variable → header text param
//   - Body {{n}} variables → body text params
//   - Dynamic buttons → button params:
//       • COPY_CODE / OTP coupon buttons  → { type: 'coupon_code', coupon_code }
//       • URL buttons whose URL has a {{n}} → { type: 'text', text } suffix
//
// Variable values come from `values` (a flat { "1": "...", ... } map — e.g. a
// broadcast's variable_mapping or a test sampleValues), falling back to the
// template's stored `samples`. Static buttons (quick reply, static URL, phone)
// and static headers need NO parameter and are intentionally omitted.
//
// Why this matters: omitting a required parameter makes Meta reject the send
// with (#131008) "Required parameter is missing" or (#132000) "Number of
// parameters does not match" — the exact failures seen on copy-code offer
// templates and body-variable templates sent with an empty mapping.

function extractVarIndexes(text) {
  const out = [];
  const re = /\{\{\s*(\d+)\s*\}\}/g;
  let m;
  while ((m = re.exec(String(text || '')))) out.push(m[1]);
  // De-dupe, numeric order.
  return [...new Set(out)].sort((a, b) => Number(a) - Number(b));
}

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}

function asObject(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return (p && typeof p === 'object') ? p : {}; } catch { return {}; } }
  return {};
}

// Resolve a single mapping value against a recipient. The value may be a
// contact-field key (name | contact_number | custom_fields.<id> | category_tag.<id>),
// in which case we pull the per-recipient value; OR any other non-empty string,
// which is treated as literal "custom text" (the same for every recipient). This
// is the contract the broadcast variable UI uses (mirrors the internal build).
function resolveTemplateParam(src, recipient) {
  const s = String(src == null ? '' : src).trim();
  if (!s) return '';
  const ctx = recipient || {};
  if (s === 'name') return ctx.name || '';
  if (s === 'contact_number') return ctx.contact_number || '';
  if (s.startsWith('custom_fields.')) {
    const id = s.slice('custom_fields.'.length);
    const v = (ctx.custom_fields || {})[id];
    return v != null ? String(v) : '';
  }
  if (s.startsWith('category_tag.')) {
    const catId = s.slice('category_tag.'.length);
    const tags = Array.isArray(ctx.tags) ? ctx.tags : [];
    const t = tags.find(tg => String(tg.category_id) === String(catId));
    return t ? (t.name || '') : '';
  }
  // Literal custom text (legacy {{contact.*}} / {{name}} tokens still expand).
  return s
    .replace(/\{\{\s*contact\.name\s*\}\}/g, ctx.name || '')
    .replace(/\{\{\s*contact\.number\s*\}\}/g, ctx.contact_number || '')
    .replace(/\{\{\s*name\s*\}\}/g, ctx.name || '')
    .replace(/\{\{\s*contact_number\s*\}\}/g, ctx.contact_number || '');
}

function resolveValue(values, samples, key, recipient) {
  const mapped = (values && values[key] != null && values[key] !== '')
    ? values[key]
    : (samples && samples[key] != null ? samples[key] : '');
  return resolveTemplateParam(mapped, recipient);
}

// Replace every {{n}} in a template body/header with its resolved value, for
// storing the human-readable message in chat_history so the Chats view shows
// "Hi John" instead of raw "Hi {{1}}". Falls back to {{n}} only when nothing
// (mapping or sample) resolves — i.e. it mirrors what was sent to Meta.
function resolveTemplateText(text, values, samples, recipient) {
  return String(text || '').replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => {
    const v = resolveValue(values, samples, n, recipient);
    return v || `{{${n}}}`;
  });
}

/**
 * @param {object}   args
 * @param {object}   args.template       { header_type, header_text, body, buttons, samples }
 * @param {object}  [args.values]        explicit variable map (variable_mapping / sampleValues)
 * @param {string}  [args.headerMediaId] resolved per-account Meta media id for a media header
 * @param {object}  [args.recipient]     { name, contact_number } for {{contact.*}} placeholders
 * @returns {Array} Meta components array (may be empty for fully-static templates)
 */
function buildTemplateComponents({ template, values, headerMediaId, recipient } = {}) {
  const tpl = template || {};
  const components = [];
  const samples = asObject(tpl.samples);
  const vals = asObject(values);

  // ── Header ────────────────────────────────────────────────────────────────
  const ht = String(tpl.header_type || 'NONE').toUpperCase();
  if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(ht)) {
    if (headerMediaId) {
      const key = ht.toLowerCase(); // image | video | document
      components.push({ type: 'header', parameters: [{ type: key, [key]: { id: headerMediaId } }] });
    }
    // No headerMediaId → caller couldn't resolve the media; let the send fail
    // loudly rather than silently dropping the required header.
  } else if (ht === 'TEXT') {
    const hv = extractVarIndexes(tpl.header_text);
    if (hv.length > 0) {
      components.push({
        type: 'header',
        parameters: hv.map(k => ({ type: 'text', text: resolveValue(vals, samples, k, recipient) || ' ' })),
      });
    }
  }

  // ── Body ────────────────────────────────────────────────────────────────
  // Derive required params from the body text itself, not from the caller's
  // mapping — so a body with {{1}} still gets a parameter (from samples) even
  // when the broadcast was created with an empty variable_mapping.
  const bodyVars = extractVarIndexes(tpl.body);
  if (bodyVars.length > 0) {
    components.push({
      type: 'body',
      parameters: bodyVars.map(k => ({ type: 'text', text: resolveValue(vals, samples, k, recipient) || ' ' })),
    });
  }

  // ── Buttons (dynamic only) ─────────────────────────────────────────────────
  asArray(tpl.buttons).forEach((btn, index) => {
    const type = String(btn?.type || '').toUpperCase();
    if (type === 'COPY_CODE' || type === 'OTP') {
      const code = btn.value || btn.coupon_code || btn.example || '';
      if (code) {
        components.push({
          type: 'button', sub_type: 'copy_code', index: String(index),
          parameters: [{ type: 'coupon_code', coupon_code: String(code) }],
        });
      }
    } else if (type === 'URL') {
      const url = String(btn.value || '');
      if (/\{\{\s*\d+\s*\}\}/.test(url)) {
        const suffix = btn.urlSample
          || resolveValue(vals, samples, extractVarIndexes(url)[0], recipient)
          || ' ';
        components.push({
          type: 'button', sub_type: 'url', index: String(index),
          parameters: [{ type: 'text', text: String(suffix) }],
        });
      }
    }
    // QUICK_REPLY, static URL, PHONE_NUMBER → no runtime parameter needed.
  });

  return components;
}

module.exports = { buildTemplateComponents, extractVarIndexes, resolveTemplateParam, resolveTemplateText };
