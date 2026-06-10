// Shared AI-Agent business logic — used by BOTH the cookie-authed routes
// (routes/agents.js) and the bearer-authed MCP API (routes/mcp.js).
//
// Every mutation here performs the exact same validation the in-app builder
// relied on (draft/active invariant, supported provider, WABA-uniqueness,
// Google Sheets config). Functions throw an ApiError { status, message } so the
// calling router maps it to the right HTTP code; everything else bubbles as a
// 500.

const pool = require('../db');

const SUPPORTED_PROVIDERS = new Set(['anthropic', 'openai']);

// Lightweight typed error so routers can map status → HTTP code.
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ----------------------------- shapers ------------------------------- */

function agentShape(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    systemPrompt: row.system_prompt,
    aiModelId: row.ai_model_id,
    aiProvider: row.ai_provider || null,
    aiModelLabel: row.ai_label || null,
    llmModel: row.llm_model,
    status: row.status || 'active',
    waAccountId: row.wa_account_id,
    isActive: row.is_active,
    contextWindowMessages: row.context_window_messages,
    maxToolIterations: row.max_tool_iterations,
    transcribeAudio: !!row.transcribe_audio,
    acceptImages: !!row.accept_images,
    triggerMode: row.trigger_mode || 'any',
    triggerKeyword: row.trigger_keyword || '',
    triggerMatchType: row.trigger_match_type || 'contains',
    triggerCaseSensitive: !!row.trigger_case_sensitive,
    triggerSessionMinutes: row.trigger_session_minutes != null ? row.trigger_session_minutes : 30,
    mediaGroups: Array.isArray(row.media_groups) ? row.media_groups : [],
    crmToolsEnabled: !!row.crm_tools_enabled,
    handoffEnabled: !!row.handoff_enabled,
    handoffUserIds: Array.isArray(row.handoff_user_ids) ? row.handoff_user_ids : [],
    handoffKeywords: row.handoff_keywords || '',
    closeSummaryEnabled: !!row.close_summary_enabled,
    closeIdleMinutes: row.close_idle_minutes != null ? row.close_idle_minutes : 30,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toolShape(row) {
  return {
    id: row.id,
    agentId: row.agent_id,
    toolType: row.tool_type,
    config: row.config || {},
    isEnabled: row.is_enabled,
    createdAt: row.created_at,
  };
}

/* --------------------------- normalizers ----------------------------- */

function cleanMatchType(v) {
  return ['exact', 'contains', 'starts'].includes(v) ? v : 'contains';
}

function normalizeUrl(raw) {
  let u = String(raw || '').trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  if (!/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(u)) return null;
  return u.slice(0, 2048);
}

// Eligible BDAs for round-robin handoff: a clean array of positive integer
// user ids (deduped, capped).
function sanitizeHandoffUserIds(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const v of raw) {
    const n = parseInt(v, 10);
    if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
    if (out.length >= 50) break;
  }
  return out;
}

// Comma-separated handoff trigger keywords → trimmed string (or null).
function sanitizeKeywords(raw) {
  if (raw == null) return null;
  const s = String(raw).split(',').map(k => k.trim()).filter(Boolean).slice(0, 20).join(', ');
  return s || null;
}

function normalizeMediaGroups(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(g => {
      const tId = parseInt(g?.templateId, 10);
      return {
        description: typeof g?.description === 'string' ? g.description.trim().slice(0, 500) : '',
        mediaIds: Array.isArray(g?.mediaIds)
          ? [...new Set(g.mediaIds.map(n => parseInt(n, 10)).filter(Number.isInteger))]
          : [],
        links: Array.isArray(g?.links)
          ? [...new Set(g.links.map(normalizeUrl).filter(Boolean))].slice(0, 20)
          : [],
        templateId: Number.isInteger(tId) ? tId : null,
        templateName: typeof g?.templateName === 'string' ? g.templateName.slice(0, 200) : null,
        templateLanguage: typeof g?.templateLanguage === 'string' ? g.templateLanguage.slice(0, 20) : null,
      };
    })
    .filter(g => g.description && (g.mediaIds.length > 0 || g.links.length > 0 || g.templateId != null));
}

async function getAiModel(id) {
  if (id == null || id === '') return null;
  const { rows } = await pool.query(
    'SELECT id, provider FROM coexistence.ai_models WHERE id = $1',
    [id],
  );
  return rows[0] || null;
}

async function fetchAgent(id) {
  const { rows } = await pool.query(
    `SELECT a.*, am.provider AS ai_provider, am.label AS ai_label
       FROM coexistence.agents a
       LEFT JOIN coexistence.ai_models am ON am.id = a.ai_model_id
      WHERE a.id = $1`,
    [id],
  );
  return agentShape(rows[0]);
}

/* ------------------------------ reads -------------------------------- */

async function listAgents() {
  const { rows } = await pool.query(
    `SELECT a.*,
            am.provider AS ai_provider,
            am.label    AS ai_label,
            (SELECT COUNT(*)::int FROM coexistence.agent_tools t WHERE t.agent_id = a.id) AS tool_count,
            (SELECT MAX(started_at) FROM coexistence.agent_runs r WHERE r.agent_id = a.id) AS last_run_at
       FROM coexistence.agents a
       LEFT JOIN coexistence.ai_models am ON am.id = a.ai_model_id
       ORDER BY a.updated_at DESC`,
  );
  return rows.map(r => ({
    ...agentShape(r),
    toolCount: r.tool_count,
    lastRunAt: r.last_run_at,
  }));
}

// Returns { ...agent, tools[] } or null if the agent doesn't exist.
async function getAgent(id) {
  const { rows } = await pool.query(
    `SELECT a.*, am.provider AS ai_provider, am.label AS ai_label
       FROM coexistence.agents a
       LEFT JOIN coexistence.ai_models am ON am.id = a.ai_model_id
      WHERE a.id = $1`,
    [id],
  );
  if (rows.length === 0) return null;
  const { rows: tools } = await pool.query(
    `SELECT * FROM coexistence.agent_tools WHERE agent_id = $1 ORDER BY id`,
    [id],
  );
  return { ...agentShape(rows[0]), tools: tools.map(toolShape) };
}

/* ----------------------------- mutations ----------------------------- */

// Map a Postgres unique-violation (one active agent per WABA) to a 409.
function mapPgError(err) {
  if (err.code === '23505') {
    return new ApiError(409, 'Another agent is already active on this WhatsApp account. Disable it first.');
  }
  return err;
}

async function createAgent(b = {}) {
  if (!b.name || !b.systemPrompt) {
    throw new ApiError(400, 'name and systemPrompt are required');
  }
  const status = b.status === 'draft' ? 'draft' : 'active';
  const aiModelId = b.aiModelId || null;
  const llmModel = b.llmModel ? String(b.llmModel).trim() : null;

  if (status === 'active') {
    if (!aiModelId || !llmModel) {
      throw new ApiError(400, 'An active agent needs a connected AI model and a model selection.');
    }
    const model = await getAiModel(aiModelId);
    if (!model) throw new ApiError(400, 'Selected AI model no longer exists.');
    if (!SUPPORTED_PROVIDERS.has(model.provider)) {
      throw new ApiError(400, `Provider '${model.provider}' isn't supported by agents.`);
    }
  } else if (aiModelId) {
    const model = await getAiModel(aiModelId);
    if (!model) throw new ApiError(400, 'Selected AI model no longer exists.');
  }
  const isActive = status === 'active' ? !!b.isActive : false;

  const triggerMode = ['keyword', 'new'].includes(b.triggerMode) ? b.triggerMode : 'any';
  const triggerKeyword = typeof b.triggerKeyword === 'string' ? b.triggerKeyword.trim().slice(0, 200) : '';
  if (status === 'active' && triggerMode === 'keyword' && !triggerKeyword) {
    throw new ApiError(400, 'A keyword-triggered agent needs a keyword.');
  }
  const mediaGroups = normalizeMediaGroups(b.mediaGroups);

  try {
    const { rows } = await pool.query(
      `INSERT INTO coexistence.agents
         (name, description, system_prompt, ai_model_id, llm_model,
          status, wa_account_id, is_active,
          context_window_messages, max_tool_iterations,
          trigger_mode, trigger_keyword, trigger_match_type,
          trigger_case_sensitive, trigger_session_minutes, media_groups,
          transcribe_audio, accept_images,
          crm_tools_enabled, handoff_enabled, handoff_user_ids, handoff_keywords,
          close_summary_enabled, close_idle_minutes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
       RETURNING id`,
      [
        b.name.trim(), b.description?.trim() || null,
        b.systemPrompt, aiModelId, llmModel,
        status, b.waAccountId || null, isActive,
        Math.max(1, Math.min(100, parseInt(b.contextWindowMessages || 20, 10))),
        Math.max(1, Math.min(20, parseInt(b.maxToolIterations || 6, 10))),
        triggerMode, triggerKeyword || null, cleanMatchType(b.triggerMatchType),
        !!b.triggerCaseSensitive,
        Math.max(1, Math.min(1440, parseInt(b.triggerSessionMinutes || 30, 10))),
        JSON.stringify(mediaGroups),
        !!b.transcribeAudio,
        !!b.acceptImages,
        !!b.crmToolsEnabled,
        !!b.handoffEnabled,
        JSON.stringify(sanitizeHandoffUserIds(b.handoffUserIds)),
        sanitizeKeywords(b.handoffKeywords),
        !!b.closeSummaryEnabled,
        Math.max(1, Math.min(1440, parseInt(b.closeIdleMinutes || 30, 10))),
      ],
    );
    return await fetchAgent(rows[0].id);
  } catch (err) {
    throw mapPgError(err);
  }
}

async function updateAgent(id, b = {}) {
  const { rows: existing } = await pool.query(
    'SELECT * FROM coexistence.agents WHERE id = $1',
    [id],
  );
  if (existing.length === 0) throw new ApiError(404, 'Not found');

  const cur = existing[0];
  const effStatus    = b.status !== undefined ? (b.status === 'draft' ? 'draft' : 'active') : (cur.status || 'active');
  const effModelId   = b.aiModelId !== undefined ? (b.aiModelId || null) : cur.ai_model_id;
  const effLlmModel  = b.llmModel  !== undefined ? (b.llmModel ? String(b.llmModel).trim() : null) : cur.llm_model;
  let   effIsActive  = b.isActive  !== undefined ? !!b.isActive : cur.is_active;
  if (effStatus === 'draft') effIsActive = false;

  if (effModelId) {
    const model = await getAiModel(effModelId);
    if (!model) throw new ApiError(400, 'Selected AI model no longer exists.');
    if ((effStatus === 'active' || effIsActive) && !SUPPORTED_PROVIDERS.has(model.provider)) {
      throw new ApiError(400, `Provider '${model.provider}' isn't supported by agents.`);
    }
  }
  if ((effStatus === 'active' || effIsActive) && (!effModelId || !effLlmModel)) {
    throw new ApiError(400, 'An active agent needs a connected AI model and a model selection.');
  }

  const effTrigMode = b.triggerMode !== undefined ? (['keyword', 'new'].includes(b.triggerMode) ? b.triggerMode : 'any') : (cur.trigger_mode || 'any');
  const effTrigKeyword = b.triggerKeyword !== undefined ? String(b.triggerKeyword || '').trim() : (cur.trigger_keyword || '');
  if ((effStatus === 'active' || effIsActive) && effTrigMode === 'keyword' && !effTrigKeyword) {
    throw new ApiError(400, 'A keyword-triggered agent needs a keyword.');
  }

  const sets = ['updated_at = NOW()'];
  const params = [];
  let i = 1;
  const push = (col, val) => { sets.push(`${col} = $${i++}`); params.push(val); };

  if (b.name !== undefined) push('name', b.name.trim());
  if (b.description !== undefined) push('description', b.description?.trim() || null);
  if (b.systemPrompt !== undefined) push('system_prompt', b.systemPrompt);
  if (b.aiModelId !== undefined) push('ai_model_id', effModelId);
  if (b.llmModel !== undefined) push('llm_model', effLlmModel);
  if (b.status !== undefined) push('status', effStatus);
  if (b.waAccountId !== undefined) push('wa_account_id', b.waAccountId || null);
  if (b.isActive !== undefined || b.status !== undefined) push('is_active', effIsActive);
  if (b.contextWindowMessages !== undefined) {
    push('context_window_messages', Math.max(1, Math.min(100, parseInt(b.contextWindowMessages, 10) || 20)));
  }
  if (b.transcribeAudio !== undefined) push('transcribe_audio', !!b.transcribeAudio);
  if (b.acceptImages !== undefined) push('accept_images', !!b.acceptImages);
  if (b.maxToolIterations !== undefined) {
    push('max_tool_iterations', Math.max(1, Math.min(20, parseInt(b.maxToolIterations, 10) || 6)));
  }
  if (b.triggerMode !== undefined) push('trigger_mode', effTrigMode);
  if (b.triggerKeyword !== undefined) push('trigger_keyword', effTrigKeyword || null);
  if (b.triggerMatchType !== undefined) push('trigger_match_type', cleanMatchType(b.triggerMatchType));
  if (b.triggerCaseSensitive !== undefined) push('trigger_case_sensitive', !!b.triggerCaseSensitive);
  if (b.triggerSessionMinutes !== undefined) {
    push('trigger_session_minutes', Math.max(1, Math.min(1440, parseInt(b.triggerSessionMinutes, 10) || 30)));
  }
  if (b.mediaGroups !== undefined) push('media_groups', JSON.stringify(normalizeMediaGroups(b.mediaGroups)));
  if (b.crmToolsEnabled !== undefined) push('crm_tools_enabled', !!b.crmToolsEnabled);
  if (b.handoffEnabled !== undefined) push('handoff_enabled', !!b.handoffEnabled);
  if (b.handoffUserIds !== undefined) push('handoff_user_ids', JSON.stringify(sanitizeHandoffUserIds(b.handoffUserIds)));
  if (b.handoffKeywords !== undefined) push('handoff_keywords', sanitizeKeywords(b.handoffKeywords));
  if (b.closeSummaryEnabled !== undefined) push('close_summary_enabled', !!b.closeSummaryEnabled);
  if (b.closeIdleMinutes !== undefined) push('close_idle_minutes', Math.max(1, Math.min(1440, parseInt(b.closeIdleMinutes, 10) || 30)));

  params.push(id);
  try {
    const { rows } = await pool.query(
      `UPDATE coexistence.agents SET ${sets.join(', ')} WHERE id = $${i} RETURNING id`,
      params,
    );
    return await fetchAgent(rows[0].id);
  } catch (err) {
    throw mapPgError(err);
  }
}

async function deleteAgent(id) {
  const { rowCount } = await pool.query(
    'DELETE FROM coexistence.agents WHERE id = $1',
    [id],
  );
  if (rowCount === 0) throw new ApiError(404, 'Not found');
  return { ok: true };
}

/* --------------------------- export / import ------------------------- */

// Portable agent file: full config + tools, no internal ids (kept only as
// best-effort relink hints). Secrets in tool configs (e.g. HTTP auth headers)
// ARE included so the imported agent works — the file is admin-only.
async function exportAgent(id) {
  const full = await getAgent(id);
  if (!full) throw new ApiError(404, 'Not found');
  return {
    type: 'forgechat.agent',
    version: 1,
    agent: {
      name: full.name,
      description: full.description,
      systemPrompt: full.systemPrompt,
      llmModel: full.llmModel,
      aiProvider: full.aiProvider,       // hint for cross-instance model match
      aiModelLabel: full.aiModelLabel,   // hint
      aiModelId: full.aiModelId,         // same-instance relink
      waAccountId: full.waAccountId,     // same-instance relink
      contextWindowMessages: full.contextWindowMessages,
      maxToolIterations: full.maxToolIterations,
      transcribeAudio: full.transcribeAudio,
      acceptImages: full.acceptImages,
      triggerMode: full.triggerMode,
      triggerKeyword: full.triggerKeyword,
      triggerMatchType: full.triggerMatchType,
      triggerCaseSensitive: full.triggerCaseSensitive,
      triggerSessionMinutes: full.triggerSessionMinutes,
      mediaGroups: full.mediaGroups,
    },
    tools: (full.tools || []).map(t => ({ toolType: t.toolType, config: t.config, isEnabled: t.isEnabled })),
  };
}

// Resolve an exported model reference to a local ai_models id: exact id first,
// then provider+label, then provider alone. Returns null when nothing matches.
async function resolveModelId({ aiModelId, aiProvider, aiModelLabel }) {
  if (aiModelId) {
    const m = await getAiModel(aiModelId);
    if (m) return aiModelId;
  }
  if (aiProvider) {
    const { rows } = await pool.query(
      `SELECT id FROM coexistence.ai_models
        WHERE provider = $1 AND ($2::text IS NULL OR label = $2)
        ORDER BY id LIMIT 1`,
      [aiProvider, aiModelLabel || null],
    );
    if (rows[0]) return rows[0].id;
    const { rows: any } = await pool.query(
      `SELECT id FROM coexistence.ai_models WHERE provider = $1 ORDER BY id LIMIT 1`,
      [aiProvider],
    );
    if (any[0]) return any[0].id;
  }
  return null;
}

// Create a NEW agent from an export file. Always lands as a draft (never
// auto-activates), relinks model/number when they resolve here, and re-adds
// every tool. Returns { agent, warnings }.
async function importAgent(payload = {}) {
  if (!payload || payload.type !== 'forgechat.agent' || !payload.agent) {
    throw new ApiError(400, 'That file is not a ForgeChat agent export.');
  }
  const a = payload.agent;
  if (!a.name || !a.systemPrompt) {
    throw new ApiError(400, 'The export file is missing required agent fields (name / system prompt).');
  }

  const aiModelId = await resolveModelId(a);
  const llmModel = aiModelId ? (a.llmModel || null) : null;

  let waAccountId = null;
  if (a.waAccountId) {
    const { rows } = await pool.query('SELECT id FROM coexistence.whatsapp_accounts WHERE id = $1', [a.waAccountId]);
    if (rows[0]) waAccountId = a.waAccountId;
  }

  const created = await createAgent({
    name: `${a.name} (imported)`.slice(0, 200),
    description: a.description || null,
    systemPrompt: a.systemPrompt,
    aiModelId,
    llmModel,
    waAccountId,
    status: 'draft',         // always import as a draft; user reviews + activates
    isActive: false,
    contextWindowMessages: a.contextWindowMessages,
    maxToolIterations: a.maxToolIterations,
    transcribeAudio: a.transcribeAudio,
    acceptImages: a.acceptImages,
    triggerMode: a.triggerMode,
    triggerKeyword: a.triggerKeyword,
    triggerMatchType: a.triggerMatchType,
    triggerCaseSensitive: a.triggerCaseSensitive,
    triggerSessionMinutes: a.triggerSessionMinutes,
    mediaGroups: a.mediaGroups,
  });

  const warnings = [];
  if (a.aiModelId && !aiModelId) warnings.push('The AI model from the file was not found here — pick a model before going live.');
  if (a.waAccountId && !waAccountId) warnings.push('The WhatsApp number from the file was not found here — pick a number before going live.');

  for (const t of (Array.isArray(payload.tools) ? payload.tools : [])) {
    try {
      await addTool(created.id, { toolType: t.toolType, config: t.config, isEnabled: t.isEnabled });
    } catch (e) {
      warnings.push(`Skipped a ${t.toolType || 'tool'}: ${e.message}`);
    }
  }

  const full = await getAgent(created.id);
  return { agent: full, warnings };
}

/* ------------------------------ tools -------------------------------- */

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const PARAM_LOCATIONS = new Set(['path', 'query', 'body', 'header']);
const PARAM_TYPES = new Set(['string', 'number', 'boolean']);

// Validate + normalise an http_request tool config. Returns the cleaned config.
// The admin owns method/url/static headers; the agent's LLM only fills the
// declared params at call time (see agentEngine http_request executor).
function validateHttpConfig(cfg = {}) {
  const label = String(cfg.label || '').trim();
  if (!label) throw new ApiError(400, 'Give the HTTP tool a name (label).');
  const description = String(cfg.description || '').trim();
  if (!description) throw new ApiError(400, 'Describe when the agent should use this HTTP tool — the AI needs it to decide.');

  const method = String(cfg.method || 'GET').trim().toUpperCase();
  if (!HTTP_METHODS.has(method)) throw new ApiError(400, `Method must be one of ${[...HTTP_METHODS].join(', ')}.`);

  const url = normalizeUrl(cfg.url);
  if (!url) throw new ApiError(400, 'Enter a valid http(s) URL for the HTTP tool.');

  const headers = Array.isArray(cfg.headers)
    ? cfg.headers
        .map(h => ({ k: String(h?.k || '').trim(), v: String(h?.v ?? '').trim() }))
        .filter(h => h.k)
        .slice(0, 30)
    : [];

  const seen = new Set();
  const params = Array.isArray(cfg.params)
    ? cfg.params.map((p, idx) => {
        const name = String(p?.name || '').trim();
        if (!name) throw new ApiError(400, `Parameter #${idx + 1} needs a name.`);
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
          throw new ApiError(400, `Parameter "${name}" must be a simple identifier (letters, numbers, underscore; no leading digit).`);
        }
        if (seen.has(name)) throw new ApiError(400, `Duplicate parameter name "${name}".`);
        seen.add(name);
        const loc = PARAM_LOCATIONS.has(p?.in) ? p.in : 'body';
        const type = PARAM_TYPES.has(p?.type) ? p.type : 'string';
        return {
          name,
          in: loc,
          type,
          description: String(p?.description || '').trim().slice(0, 500),
          required: !!p?.required,
        };
      }).slice(0, 30)
    : [];

  // Every {placeholder} in the URL must be backed by a path param.
  const placeholders = [...url.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)].map(m => m[1]);
  for (const ph of placeholders) {
    const p = params.find(x => x.name === ph);
    if (!p) throw new ApiError(400, `URL placeholder {${ph}} has no matching parameter — add a "path" parameter named "${ph}".`);
    if (p.in !== 'path') throw new ApiError(400, `Parameter "${ph}" is used in the URL path, so its location must be "path".`);
  }

  const timeoutMs = Math.max(1000, Math.min(30000, parseInt(cfg.timeout_ms || 10000, 10) || 10000));

  return { label: label.slice(0, 120), description: description.slice(0, 1000), method, url, headers, params, timeout_ms: timeoutMs };
}

// Validate a tool body by type; returns the cleaned config to persist.
function validateToolConfig(toolType, config) {
  if (toolType === 'google_sheets') {
    const cfg = config;
    if (!cfg.google_account_id || !cfg.spreadsheet_id || !cfg.sheet_name) {
      throw new ApiError(400, 'Sheets tool needs google_account_id, spreadsheet_id, sheet_name.');
    }
    if (!Array.isArray(cfg.ops) || cfg.ops.length === 0) {
      throw new ApiError(400, 'Enable at least one operation (read / append / update).');
    }
    return cfg;
  }
  if (toolType === 'http_request') {
    return validateHttpConfig(config);
  }
  return config;
}

async function addTool(agentId, b = {}) {
  if (!b.toolType || !b.config) {
    throw new ApiError(400, 'toolType and config are required');
  }
  const cleanConfig = validateToolConfig(b.toolType, b.config);
  const { rows } = await pool.query(
    `INSERT INTO coexistence.agent_tools (agent_id, tool_type, config, is_enabled)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [agentId, b.toolType, JSON.stringify(cleanConfig), b.isEnabled !== false],
  );
  return toolShape(rows[0]);
}

async function updateTool(agentId, toolId, b = {}) {
  const sets = [];
  const params = [];
  let i = 1;
  if (b.config !== undefined) {
    // Re-validate against the existing tool's type so an edit can't store junk.
    const { rows: cur } = await pool.query(
      'SELECT tool_type FROM coexistence.agent_tools WHERE agent_id = $1 AND id = $2',
      [agentId, toolId],
    );
    if (cur.length === 0) throw new ApiError(404, 'Not found');
    const cleanConfig = validateToolConfig(cur[0].tool_type, b.config);
    sets.push(`config = $${i++}`); params.push(JSON.stringify(cleanConfig));
  }
  if (b.isEnabled !== undefined) { sets.push(`is_enabled = $${i++}`); params.push(!!b.isEnabled); }
  if (sets.length === 0) throw new ApiError(400, 'No updatable fields provided');
  params.push(agentId, toolId);
  const { rows } = await pool.query(
    `UPDATE coexistence.agent_tools SET ${sets.join(', ')}
      WHERE agent_id = $${i++} AND id = $${i} RETURNING *`,
    params,
  );
  if (rows.length === 0) throw new ApiError(404, 'Not found');
  return toolShape(rows[0]);
}

async function deleteTool(agentId, toolId) {
  const { rowCount } = await pool.query(
    'DELETE FROM coexistence.agent_tools WHERE agent_id = $1 AND id = $2',
    [agentId, toolId],
  );
  if (rowCount === 0) throw new ApiError(404, 'Not found');
  return { ok: true };
}

module.exports = {
  ApiError,
  agentShape,
  toolShape,
  listAgents,
  getAgent,
  createAgent,
  updateAgent,
  deleteAgent,
  addTool,
  updateTool,
  deleteTool,
  exportAgent,
  importAgent,
};
