// Shared MCP logic used by BOTH transports:
//   - routes/mcp.js   (REST: /api/mcp/v1/*, bearer header — for the stdio server)
//   - mcpHttp.js      (Streamable HTTP: /api/mcp/http/:key — remote connector)
//
// Holds the settings/key-validation + discovery queries so the two transports
// can't drift. Agent create/update/tool ops live in services/agentService.js.

const pool = require('../db');
const { hashApiKey } = require('../util/crypto');
const googleSheets = require('./googleSheets'); // Forge-Chat per-account Google client

// Static LLM catalog — keep in sync with frontend/src/components/agents/modelCatalog.js.
const MODEL_CATALOG = {
  anthropic: [
    { value: 'claude-opus-4-7', label: 'Claude Opus 4.7 (most capable)' },
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (balanced)' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (fastest)' },
  ],
  openai: [
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4o-mini', label: 'GPT-4o mini' },
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
  ],
};
const PROVIDER_LABELS = { anthropic: 'Anthropic Claude', openai: 'OpenAI', claude_code: 'Claude Code' };
const CAPABILITY_KEYS = ['discovery', 'create_agent', 'update_agent', 'manage_tools', 'delete'];

/* --------------------------- tables + settings --------------------------- */

// Self-healing table creation (mirrors migration 053_mcp.sql).
async function ensureMcpTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS coexistence.mcp_api_keys (
      id           BIGSERIAL PRIMARY KEY,
      label        TEXT NOT NULL,
      key_prefix   TEXT NOT NULL,
      key_last4    TEXT NOT NULL,
      key_hash     TEXT NOT NULL UNIQUE,
      is_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
      last_used_at TIMESTAMPTZ,
      created_by   BIGINT REFERENCES coexistence.forgecrm_users(id) ON DELETE SET NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS coexistence.mcp_settings (
      id             INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      master_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      capabilities   JSONB NOT NULL DEFAULT '{"discovery":true,"create_agent":true,"update_agent":true,"manage_tools":true,"delete":true}'::jsonb,
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query(`INSERT INTO coexistence.mcp_settings (id) VALUES (1) ON CONFLICT DO NOTHING`);
}

async function loadSettings() {
  const { rows } = await pool.query('SELECT master_enabled, capabilities FROM coexistence.mcp_settings WHERE id = 1');
  const r = rows[0] || { master_enabled: false, capabilities: {} };
  return { masterEnabled: !!r.master_enabled, capabilities: r.capabilities || {} };
}

// Validate a raw bearer key. Returns { capabilities, keyId } on success.
// Throws { status, message } on any failure so callers map to HTTP codes.
async function validateKey(rawKey) {
  const key = String(rawKey || '').trim();
  if (!key) { const e = new Error('Missing API key'); e.status = 401; throw e; }
  const { rows } = await pool.query(
    'SELECT * FROM coexistence.mcp_api_keys WHERE key_hash = $1',
    [hashApiKey(key)],
  );
  const row = rows[0];
  if (!row || !row.is_enabled) { const e = new Error('Invalid or disabled API key'); e.status = 401; throw e; }
  const settings = await loadSettings();
  if (!settings.masterEnabled) { const e = new Error('MCP access is disabled'); e.status = 403; throw e; }
  pool.query('UPDATE coexistence.mcp_api_keys SET last_used_at = NOW() WHERE id = $1', [row.id]).catch(() => {});
  return { keyId: row.id, capabilities: settings.capabilities };
}

/* ------------------------------ discovery ------------------------------- */

async function listWaAccounts() {
  const { rows } = await pool.query(
    `SELECT id, display_name, display_phone_number, is_active, is_default
       FROM coexistence.whatsapp_accounts ORDER BY is_default DESC, display_name`,
  );
  return rows.map(r => ({
    id: r.id,
    displayName: r.display_name,
    phoneNumber: r.display_phone_number,
    isActive: r.is_active,
    isDefault: r.is_default,
  }));
}

async function listModels() {
  const { rows } = await pool.query(
    `SELECT id, provider, label FROM coexistence.ai_models ORDER BY created_at DESC`,
  );
  return rows
    .filter(r => MODEL_CATALOG[r.provider])
    .map(r => ({
      aiModelId: r.id,
      provider: r.provider,
      providerLabel: PROVIDER_LABELS[r.provider] || r.provider,
      label: r.label,
      models: MODEL_CATALOG[r.provider],
    }));
}

// Forge-Chat's Google integration is PER-ACCOUNT: spreadsheets/tabs are listed
// against a connected Google account (oauth_credentials id). So the MCP flow
// first lists accounts, then lists that account's spreadsheets, then its tabs.
async function listGoogleAccounts() {
  const { rows } = await pool.query(
    `SELECT id, account_label, health_status FROM coexistence.oauth_credentials
      WHERE provider = 'google' ORDER BY created_at DESC`,
  );
  return rows.map(r => ({ id: r.id, label: r.account_label, status: r.health_status }));
}

async function searchSpreadsheets({ googleAccountId, q = '', pageSize = 50 } = {}) {
  if (!googleAccountId) {
    const e = new Error('Pick a Google account first (call list_google_accounts).'); e.status = 400; throw e;
  }
  const spreadsheets = await googleSheets.listSpreadsheets(googleAccountId, { query: q, pageSize: Math.max(1, Math.min(100, pageSize)) });
  return { spreadsheets };
}

function listSheetTabs(googleAccountId, spreadsheetId) {
  if (!googleAccountId) {
    return Promise.reject(Object.assign(new Error('Pick a Google account first (call list_google_accounts).'), { status: 400 }));
  }
  return googleSheets.listSheetTabs(googleAccountId, spreadsheetId).then(tabs => ({ id: spreadsheetId, tabs }));
}

// Read actual cell values from a tab so the assistant can see the real header
// row (and a few sample rows) — needed to map an agent's Sheets logging to the
// right columns. listSheetTabs only returns metadata (names/dimensions), not
// contents, so this fills that gap. Defaults to the whole tab from A1 capped at
// maxRows; pass an A1 `range` to narrow it (e.g. "A1:Z1" for just the header).
async function readSheetValues({ googleAccountId, spreadsheetId, tab, range, maxRows } = {}) {
  if (!googleAccountId) { const e = new Error('Pick a Google account first (call list_google_accounts).'); e.status = 400; throw e; }
  if (!spreadsheetId) { const e = new Error('spreadsheetId is required (from search_spreadsheets).'); e.status = 400; throw e; }
  if (!tab) { const e = new Error('tab is required (the tab name from list_sheet_tabs).'); e.status = 400; throw e; }
  const out = await googleSheets.read({
    credentialId: googleAccountId,
    spreadsheetId,
    sheetName: tab,
    args: { range: range || undefined, max_rows: Math.max(1, Math.min(500, parseInt(maxRows || 50, 10))) },
  });
  const rows = out.rows || [];
  return {
    spreadsheetId,
    tab,
    range: out.range,
    headers: rows[0] || [],      // first returned row — the column headers when the range starts at row 1
    rows: rows.slice(1),         // data rows after the header
    rowCount: out.rowCount,
    truncated: out.truncated,
  };
}

async function listMedia(type, name) {
  const { rows } = await pool.query(
    `SELECT id, name, original_name, mime_type, media_type
       FROM coexistence.media_library
      WHERE ($1::text IS NULL OR media_type = $1)
        AND ($2::text IS NULL OR name ILIKE $2 OR original_name ILIKE $2)
      ORDER BY uploaded_at DESC LIMIT 200`,
    [type || null, name ? `%${name}%` : null],
  );
  return rows.map(r => ({ id: r.id, name: r.name || r.original_name, mimeType: r.mime_type, mediaType: r.media_type }));
}

async function listTemplates(waAccountId) {
  const waId = waAccountId != null && waAccountId !== '' ? parseInt(waAccountId, 10) : null;
  const { rows } = await pool.query(
    `SELECT id, name, language, status, category, whatsapp_account_id
       FROM coexistence.message_templates
      WHERE ($1::bigint IS NULL OR whatsapp_account_id = $1)
      ORDER BY name`,
    [waId],
  );
  return rows.map(r => ({
    id: r.id, name: r.name, language: r.language, status: r.status,
    category: r.category, waAccountId: r.whatsapp_account_id,
  }));
}

async function getTemplate(id) {
  const { rows } = await pool.query(
    `SELECT id, name, language, status, category, whatsapp_account_id,
            header_type, header_text, body, footer, buttons, samples
       FROM coexistence.message_templates WHERE id = $1`,
    [parseInt(id, 10)],
  );
  if (!rows[0]) { const e = new Error('Template not found'); e.status = 404; throw e; }
  const r = rows[0];
  return {
    id: r.id,
    name: r.name,
    language: r.language,
    status: r.status,
    category: r.category,
    waAccountId: r.whatsapp_account_id,
    header: r.header_type
      ? { type: r.header_type, text: r.header_text || null }
      : null,
    body: r.body,
    footer: r.footer || null,
    buttons: r.buttons || [],
    samples: r.samples || {},
  };
}

module.exports = {
  MODEL_CATALOG, PROVIDER_LABELS, CAPABILITY_KEYS,
  ensureMcpTables, loadSettings, validateKey,
  listWaAccounts, listModels, listGoogleAccounts, searchSpreadsheets, listSheetTabs, readSheetValues, listMedia, listTemplates, getTemplate,
};
