// External MCP access — admin management + REST API for the stdio MCP server.
//
//   adminRouter  (mounted under authMiddleware, every route adminOnly)
//       /mcp/settings  GET|PUT   — master switch + capability toggles
//       /mcp/keys      GET|POST|PUT|DELETE — bearer API keys (plaintext shown once)
//       /mcp/install   GET       — connection details for the UI install panel
//
//   apiRouter   (mounted on /api/mcp/v1, OWN bearer middleware — header auth)
//       discovery + agent CRUD consumed by the local (stdio) MCP server.
//
// The REMOTE (Streamable HTTP) transport lives in ../mcpHttp.js and shares the
// same key-validation + discovery via services/mcpService.js.

const { Router } = require('express');
const crypto = require('crypto');
const pool = require('../db');
const { adminOnly } = require('../middleware/access');
const { hashApiKey } = require('../util/crypto');
const agentService = require('../services/agentService');
const mcpService = require('../services/mcpService');

const { CAPABILITY_KEYS, ensureMcpTables, loadSettings } = mcpService;

/* ============================ admin router ============================ */

const adminRouter = Router();

adminRouter.get('/mcp/settings', adminOnly, async (req, res) => {
  try {
    res.json(await loadSettings());
  } catch (err) {
    console.error('[mcp] settings get error:', err.message);
    res.status(500).json({ error: 'Failed to load MCP settings' });
  }
});

adminRouter.put('/mcp/settings', adminOnly, async (req, res) => {
  try {
    const b = req.body || {};
    const cur = await loadSettings();
    const masterEnabled = b.masterEnabled !== undefined ? !!b.masterEnabled : cur.masterEnabled;
    const caps = { ...cur.capabilities };
    if (b.capabilities && typeof b.capabilities === 'object') {
      for (const k of CAPABILITY_KEYS) {
        if (b.capabilities[k] !== undefined) caps[k] = !!b.capabilities[k];
      }
    }
    await pool.query(
      `UPDATE coexistence.mcp_settings
          SET master_enabled = $1, capabilities = $2, updated_at = NOW()
        WHERE id = 1`,
      [masterEnabled, JSON.stringify(caps)],
    );
    res.json(await loadSettings());
  } catch (err) {
    console.error('[mcp] settings put error:', err.message);
    res.status(500).json({ error: 'Failed to update MCP settings' });
  }
});

function keyShape(r) {
  return {
    id: r.id,
    label: r.label,
    keyPrefix: r.key_prefix,
    keyLast4: r.key_last4,
    isEnabled: r.is_enabled,
    lastUsedAt: r.last_used_at,
    createdAt: r.created_at,
  };
}

adminRouter.get('/mcp/keys', adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM coexistence.mcp_api_keys ORDER BY created_at DESC');
    res.json(rows.map(keyShape));
  } catch (err) {
    console.error('[mcp] keys list error:', err.message);
    res.status(500).json({ error: 'Failed to list keys' });
  }
});

adminRouter.post('/mcp/keys', adminOnly, async (req, res) => {
  try {
    const label = String(req.body?.label || '').trim();
    if (!label) return res.status(400).json({ error: 'A label is required' });
    const plain = 'fck_live_' + crypto.randomBytes(24).toString('base64url');
    const keyPrefix = plain.slice(0, 13);
    const keyLast4 = plain.slice(-4);
    const { rows } = await pool.query(
      `INSERT INTO coexistence.mcp_api_keys (label, key_prefix, key_last4, key_hash, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [label, keyPrefix, keyLast4, hashApiKey(plain), req.user?.id || null],
    );
    res.status(201).json({ ...keyShape(rows[0]), key: plain });
  } catch (err) {
    console.error('[mcp] key create error:', err.message);
    res.status(500).json({ error: 'Failed to create key' });
  }
});

adminRouter.put('/mcp/keys/:id', adminOnly, async (req, res) => {
  try {
    const b = req.body || {};
    const sets = [];
    const params = [];
    let i = 1;
    if (b.label !== undefined) { sets.push(`label = $${i++}`); params.push(String(b.label).trim()); }
    if (b.isEnabled !== undefined) { sets.push(`is_enabled = $${i++}`); params.push(!!b.isEnabled); }
    if (sets.length === 0) return res.status(400).json({ error: 'No updatable fields provided' });
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE coexistence.mcp_api_keys SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      params,
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(keyShape(rows[0]));
  } catch (err) {
    console.error('[mcp] key update error:', err.message);
    res.status(500).json({ error: 'Failed to update key' });
  }
});

adminRouter.delete('/mcp/keys/:id', adminOnly, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM coexistence.mcp_api_keys WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[mcp] key delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete key' });
  }
});

adminRouter.get('/mcp/install', adminOnly, (req, res) => {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0];
  const host = req.headers['x-forwarded-host'] || req.headers.host || (process.env.FORGECRM_DOMAIN || '');
  const base = `${proto}://${host}`;
  const apiUrl = `${base}/api/mcp/v1`;
  const remoteUrl = `${base}/api/mcp/http/<YOUR_KEY>`;
  const serverPath = process.env.MCP_SERVER_PATH || '/root/Forge-Chat/mcp-server/src/index.js';
  res.json({
    // Remote (hosted) connector — paste this URL (with a real key) into Claude's
    // "Add custom connector" dialog or any MCP client. No local files needed.
    remoteUrl,
    // Local (stdio) connector — for the node server run from a config file.
    apiUrl,
    serverPath,
    configSnippet: {
      mcpServers: {
        'forgechat-agents': {
          command: 'node',
          args: [serverPath],
          env: { FORGECHAT_API_URL: apiUrl, FORGECHAT_API_KEY: 'fck_live_PASTE_YOUR_KEY' },
        },
      },
    },
  });
});

/* ============================= api router ============================ */

const apiRouter = Router();

// Bearer auth (header) + capability gating for every /api/mcp/v1 request.
async function mcpKeyAuth(req, res, next) {
  try {
    const hdr = req.headers.authorization || '';
    const m = hdr.match(/^Bearer\s+(.+)$/i);
    if (!m) return res.status(401).json({ error: 'Missing bearer token' });
    const { capabilities, keyId } = await mcpService.validateKey(m[1]);
    req.mcp = { capabilities };
    req.user = { id: keyId, role: 'admin', viaMcp: true };
    next();
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Authentication failed' });
  }
}

function requireCap(name) {
  return (req, res, next) => {
    if (req.mcp?.capabilities?.[name] !== true) {
      return res.status(403).json({ error: `The '${name}' capability is disabled for MCP access.` });
    }
    next();
  };
}

apiRouter.use(mcpKeyAuth);

function sendErr(res, err, fallback) {
  if (err instanceof agentService.ApiError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(`[mcp] ${fallback}:`, err.message);
  return res.status(500).json({ error: fallback });
}

// Surface "Google not connected" discovery errors as 400 instead of 500.
async function discovery(res, fn, fallback) {
  try {
    res.json(await fn());
  } catch (err) {
    const msg = err?.message || fallback;
    if (/connect|token|credential|integration|auth/i.test(msg)) {
      return res.status(400).json({ error: msg });
    }
    console.error(`[mcp] ${fallback}:`, msg);
    res.status(500).json({ error: fallback });
  }
}

/* --------- discovery --------- */
apiRouter.get('/wa-accounts', requireCap('discovery'), (req, res) =>
  discovery(res, () => mcpService.listWaAccounts(), 'Failed to list WhatsApp accounts'));
apiRouter.get('/models', requireCap('discovery'), (req, res) =>
  discovery(res, () => mcpService.listModels(), 'Failed to list models'));
apiRouter.get('/google-accounts', requireCap('discovery'), (req, res) =>
  discovery(res, () => mcpService.listGoogleAccounts(), 'Failed to list Google accounts'));
apiRouter.get('/spreadsheets', requireCap('discovery'), (req, res) =>
  discovery(res, () => mcpService.searchSpreadsheets({ googleAccountId: req.query.googleAccountId, q: String(req.query.q || ''), pageSize: parseInt(req.query.pageSize || '50', 10) }), 'Failed to list spreadsheets'));
apiRouter.get('/spreadsheets/:id/tabs', requireCap('discovery'), (req, res) =>
  discovery(res, () => mcpService.listSheetTabs(req.query.googleAccountId, req.params.id), 'Failed to load spreadsheet tabs'));
apiRouter.get('/spreadsheets/:id/values', requireCap('discovery'), (req, res) =>
  discovery(res, () => mcpService.readSheetValues({
    googleAccountId: req.query.googleAccountId,
    spreadsheetId: req.params.id,
    tab: req.query.tab,
    range: req.query.range || undefined,
    maxRows: req.query.maxRows,
  }), 'Failed to read spreadsheet values'));
apiRouter.get('/media', requireCap('discovery'), (req, res) =>
  discovery(res, () => mcpService.listMedia(
    req.query.type ? String(req.query.type) : null,
    req.query.name ? String(req.query.name) : null,
  ), 'Failed to list media'));
apiRouter.get('/templates', requireCap('discovery'), (req, res) =>
  discovery(res, () => mcpService.listTemplates(req.query.waAccountId), 'Failed to list templates'));
apiRouter.get('/templates/:id', requireCap('discovery'), (req, res) =>
  discovery(res, () => mcpService.getTemplate(req.params.id), 'Failed to fetch template'));
apiRouter.get('/agents', requireCap('discovery'), async (req, res) => {
  try { res.json(await agentService.listAgents()); } catch (err) { sendErr(res, err, 'Failed to list agents'); }
});
apiRouter.get('/agents/:id', requireCap('discovery'), async (req, res) => {
  try {
    const agent = await agentService.getAgent(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Not found' });
    res.json(agent);
  } catch (err) { sendErr(res, err, 'Failed to fetch agent'); }
});

/* --------- mutations --------- */
apiRouter.post('/agents', requireCap('create_agent'), async (req, res) => {
  try { res.status(201).json(await agentService.createAgent(req.body || {})); } catch (err) { sendErr(res, err, 'Failed to create agent'); }
});
apiRouter.put('/agents/:id', requireCap('update_agent'), async (req, res) => {
  try { res.json(await agentService.updateAgent(req.params.id, req.body || {})); } catch (err) { sendErr(res, err, 'Failed to update agent'); }
});
apiRouter.post('/agents/:id/tools', requireCap('manage_tools'), async (req, res) => {
  try { res.status(201).json(await agentService.addTool(req.params.id, req.body || {})); } catch (err) { sendErr(res, err, 'Failed to add tool'); }
});
apiRouter.put('/agents/:id/tools/:toolId', requireCap('manage_tools'), async (req, res) => {
  try { res.json(await agentService.updateTool(req.params.id, req.params.toolId, req.body || {})); } catch (err) { sendErr(res, err, 'Failed to update tool'); }
});
apiRouter.delete('/agents/:id/tools/:toolId', requireCap('delete'), async (req, res) => {
  try { res.json(await agentService.deleteTool(req.params.id, req.params.toolId)); } catch (err) { sendErr(res, err, 'Failed to delete tool'); }
});
apiRouter.delete('/agents/:id', requireCap('delete'), async (req, res) => {
  try { res.json(await agentService.deleteAgent(req.params.id)); } catch (err) { sendErr(res, err, 'Failed to delete agent'); }
});

module.exports = { adminRouter, apiRouter, ensureMcpTables };
