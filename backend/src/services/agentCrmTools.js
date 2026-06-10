// CRM write-back tools for the AI agent.
//
// These let an agent act on its OWN conversation's contact inside ForgeChat's
// native CRM (name, tags, custom fields) — not just an external sheet. They're
// only built when the agent has `crm_tools_enabled` AND there's a real live
// contact (skipped in the test preview). Each executor is scoped to a single
// (wa_number, contact_number) so the LLM can't touch other contacts.

const pool = require('../db');
const bus = require('../events');

function emit(event, payload) { try { bus.emit(event, payload); } catch { /* best-effort SSE */ } }

// Normalize a field name to a stable key. MUST match the engine + frontend so
// name→field resolution agrees.
function fieldVarKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

async function resolveWaNumber(waAccountId) {
  if (!waAccountId) return null;
  const { rows } = await pool.query(
    'SELECT display_phone_number FROM coexistence.whatsapp_accounts WHERE id = $1',
    [waAccountId],
  );
  return rows[0]?.display_phone_number || null;
}

// Build the CRM tool defs + executors scoped to one contact.
function buildCrmTools({ waNumber, contactNumber }) {
  const tools = [];
  const executors = {};
  const WHERE = 'wa_number = $1 AND contact_number = $2';
  const key = [waNumber, contactNumber];

  tools.push({
    name: 'set_contact_name',
    description: "Save the customer's name onto their ForgeChat CRM contact record. Call this once you learn their name so it shows on the Contacts page and chat.",
    input_schema: { type: 'object', properties: { name: { type: 'string', description: 'The customer\'s name.' } }, required: ['name'] },
  });
  executors['set_contact_name'] = async ({ name }) => {
    if (!name || !String(name).trim()) throw new Error('name is required');
    await pool.query(`UPDATE coexistence.contacts SET name = $3, updated_at = NOW() WHERE ${WHERE}`, [...key, String(name).trim()]);
    emit('contact-saved', { waNumber, contactNumber });
    return { ok: true, name: String(name).trim() };
  };

  tools.push({
    name: 'add_contact_tag',
    description: 'Add an existing CRM tag to this contact (label leads, e.g. "Hot Lead", "Trial Booked"). The tag must already exist; if it doesn\'t this returns an error and you should just carry on.',
    input_schema: { type: 'object', properties: { tag: { type: 'string', description: 'Exact tag name.' } }, required: ['tag'] },
  });
  executors['add_contact_tag'] = async ({ tag }) => {
    if (!tag) throw new Error('tag is required');
    const { rows: tr } = await pool.query('SELECT id, name, color, category_id FROM coexistence.tags WHERE LOWER(name) = LOWER($1) LIMIT 1', [String(tag).trim()]);
    if (!tr[0]) return { ok: false, error: `No tag named "${tag}" exists.` };
    const { rows: cr } = await pool.query(`SELECT tags FROM coexistence.contacts WHERE ${WHERE}`, key);
    const cur = Array.isArray(cr[0]?.tags) ? cr[0].tags : [];
    if (cur.some(t => String(t.id) === String(tr[0].id))) return { ok: true, already: true, tag: tr[0].name };
    const next = [...cur, { id: tr[0].id, name: tr[0].name, color: tr[0].color, category_id: tr[0].category_id }];
    await pool.query(`UPDATE coexistence.contacts SET tags = $3, updated_at = NOW() WHERE ${WHERE}`, [...key, JSON.stringify(next)]);
    emit('contact-saved', { waNumber, contactNumber });
    return { ok: true, tag: tr[0].name };
  };

  tools.push({
    name: 'set_contact_field',
    description: 'Set a custom CRM field on this contact by the field NAME (e.g. "City", "Date of Birth"). The field must already be defined in the CRM; otherwise this returns the list of valid fields and you should carry on.',
    input_schema: { type: 'object', properties: { field: { type: 'string', description: 'The field name.' }, value: { type: ['string', 'number', 'boolean'], description: 'The value to store.' } }, required: ['field', 'value'] },
  });
  executors['set_contact_field'] = async ({ field, value }) => {
    if (!field) throw new Error('field is required');
    const { rows: fd } = await pool.query('SELECT id, name FROM coexistence.contact_field_definitions');
    const vk = fieldVarKey(field);
    const def = fd.find(f => fieldVarKey(f.name) === vk || String(f.id) === String(field));
    if (!def) return { ok: false, error: `No CRM field named "${field}". Valid fields: ${fd.map(f => f.name).join(', ') || '(none)'}` };
    const { rows: cr } = await pool.query(`SELECT custom_fields FROM coexistence.contacts WHERE ${WHERE}`, key);
    const cf = (cr[0]?.custom_fields && typeof cr[0].custom_fields === 'object') ? cr[0].custom_fields : {};
    cf[def.id] = value;
    await pool.query(`UPDATE coexistence.contacts SET custom_fields = $3, updated_at = NOW() WHERE ${WHERE}`, [...key, JSON.stringify(cf)]);
    emit('contact-saved', { waNumber, contactNumber });
    return { ok: true, field: def.name, value };
  };

  return { tools, executors };
}

module.exports = { buildCrmTools, resolveWaNumber, fieldVarKey };
