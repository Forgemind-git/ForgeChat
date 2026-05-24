// Meta WhatsApp Cloud API — Template Management
// Submits a template definition for review. Meta returns the template's status
// immediately (often PENDING; sometimes auto-APPROVED or auto-REJECTED).

const META_API_VERSION = process.env.META_API_VERSION || 'v21.0';

/**
 * Submit a template for review.
 * @param {string} wabaId
 * @param {string} accessToken
 * @param {object} payload — { name, language, category, components, allow_category_change? }
 * @returns Meta response { id, status, category }
 */
async function submitTemplate(wabaId, accessToken, payload) {
  const url = `https://graph.facebook.com/${META_API_VERSION}/${encodeURIComponent(wabaId)}/message_templates`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch {}
  if (!res.ok) {
    const err = new Error(`Meta submit ${res.status}: ${parsed?.error?.message || text.slice(0, 300)}`);
    err.status = res.status;
    err.metaError = parsed?.error || null;
    throw err;
  }
  return parsed; // { id, status, category }
}

/**
 * Delete a template (only DRAFT/REJECTED locally — Meta supports delete on its side too).
 */
async function deleteTemplate(wabaId, accessToken, name) {
  const url = `https://graph.facebook.com/${META_API_VERSION}/${encodeURIComponent(wabaId)}/message_templates?name=${encodeURIComponent(name)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Meta delete ${res.status}: ${text.slice(0, 200)}`);
  }
  return true;
}

/**
 * List all templates on a WABA with their current Meta-side status, quality,
 * rejection reason, and category-change history. Used by /templates/sync.
 */
async function listTemplates(wabaId, accessToken, { fields, limit = 100 } = {}) {
  const f = fields || 'name,language,status,category,previous_category,quality_score,rejected_reason,id';
  const url = `https://graph.facebook.com/${META_API_VERSION}/${encodeURIComponent(wabaId)}/message_templates`
    + `?fields=${encodeURIComponent(f)}&limit=${limit}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch {}
  if (!res.ok) {
    const err = new Error(`Meta listTemplates ${res.status}: ${parsed?.error?.message || text.slice(0, 200)}`);
    err.status = res.status;
    err.metaError = parsed?.error || null;
    throw err;
  }
  return parsed?.data || [];
}

/**
 * Edit an APPROVED template. Meta accepts a partial payload — only the
 * components you want to change, plus optionally `category` (only for
 * MARKETING<->UTILITY swaps; AUTHENTICATION cannot be re-categorized).
 * Note: `name` and `language` cannot be edited.
 *
 * Meta enforces 10 edits/hour and 10 edits/day per template.
 *
 * @param {string} metaTemplateId — Meta's template id (we store this as meta_template_id)
 * @param {string} accessToken
 * @param {object} payload — { components, category? }
 * @returns {object} { success: true }
 */
async function editTemplate(metaTemplateId, accessToken, payload) {
  const url = `https://graph.facebook.com/${META_API_VERSION}/${encodeURIComponent(metaTemplateId)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch {}
  if (!res.ok) {
    const err = new Error(`Meta edit ${res.status}: ${parsed?.error?.message || text.slice(0, 300)}`);
    err.status = res.status;
    err.metaError = parsed?.error || null;
    throw err;
  }
  return parsed || { success: true };
}

module.exports = { submitTemplate, editTemplate, deleteTemplate, listTemplates };
