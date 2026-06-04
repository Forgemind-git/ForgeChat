// AI Agents CRUD + runs viewer.
//
// Single-owner system, same pattern as whatsappAccounts.js: every authenticated
// request is the owner. Agents no longer carry their own API key — they
// reference a workspace-wide credential in coexistence.ai_models by FK
// (ai_model_id). The provider comes from that joined row; decryption happens in
// the engine at run time. Agents have a draft/active lifecycle: a 'draft' is
// saved with incomplete config (e.g. before a model is connected) and never
// handles live traffic until completed and activated.

const { Router } = require('express');
const pool = require('../db');
const { adminOnly } = require('../middleware/access');

const router = Router();

const SUPPORTED_PROVIDERS = new Set(['anthropic', 'openai']);

// Rows from the list/get queries carry joined ai_models columns aliased
// ai_provider / ai_label so the UI can render "OpenAI — My key" without a
// second round-trip.
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
    triggerMode: row.trigger_mode || 'any',
    triggerKeyword: row.trigger_keyword || '',
    triggerMatchType: row.trigger_match_type || 'contains',
    triggerCaseSensitive: !!row.trigger_case_sensitive,
    triggerSessionMinutes: row.trigger_session_minutes != null ? row.trigger_session_minutes : 30,
    mediaGroups: Array.isArray(row.media_groups) ? row.media_groups : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Coerce a raw match type to one of the supported values.
function cleanMatchType(v) {
  return ['exact', 'contains', 'starts'].includes(v) ? v : 'contains';
}

// Coerce a raw string into a sane http(s) URL, or null if it doesn't look like one.
function normalizeUrl(raw) {
  let u = String(raw || '').trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u; // tolerate "example.com"
  if (!/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(u)) return null; // must have a dot/host
  return u.slice(0, 2048);
}

// Normalize the media_groups payload: keep only well-formed
// { description, mediaIds:[int], links:[url], templateId } groups that have a
// description AND at least one media id, link, OR an attached template (empty
// rows from the editor are dropped). `templateId` lets a group also fire an
// approved WhatsApp template when the agent sends it.
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

// Resolve + validate an ai_models row. Returns the row, or null if not found.
async function getAiModel(id) {
  if (id == null || id === '') return null;
  const { rows } = await pool.query(
    'SELECT id, provider FROM coexistence.ai_models WHERE id = $1',
    [id],
  );
  return rows[0] || null;
}

// Re-fetch one agent with the joined provider columns so mutation responses
// carry the same shape as the list/get endpoints.
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

router.get('/agents', async (req, res) => {
  try {
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
    res.json(rows.map(r => ({
      ...agentShape(r),
      toolCount: r.tool_count,
      lastRunAt: r.last_run_at,
    })));
  } catch (err) {
    console.error('[agents] list error:', err.message);
    res.status(500).json({ error: 'Failed to list agents' });
  }
});

router.get('/agents/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.*, am.provider AS ai_provider, am.label AS ai_label
         FROM coexistence.agents a
         LEFT JOIN coexistence.ai_models am ON am.id = a.ai_model_id
        WHERE a.id = $1`,
      [req.params.id],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });

    const { rows: tools } = await pool.query(
      `SELECT * FROM coexistence.agent_tools WHERE agent_id = $1 ORDER BY id`,
      [req.params.id],
    );
    res.json({
      ...agentShape(rows[0]),
      tools: tools.map(toolShape),
    });
  } catch (err) {
    console.error('[agents] get error:', err.message);
    res.status(500).json({ error: 'Failed to fetch agent' });
  }
});

router.post('/agents', adminOnly, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name || !b.systemPrompt) {
      return res.status(400).json({ error: 'name and systemPrompt are required' });
    }
    // A 'draft' may be saved with no model yet (e.g. the operator left to
    // connect an AI model). Anything else is 'active' and must be runnable.
    const status = b.status === 'draft' ? 'draft' : 'active';
    const aiModelId = b.aiModelId || null;
    const llmModel = b.llmModel ? String(b.llmModel).trim() : null;

    if (status === 'active') {
      if (!aiModelId || !llmModel) {
        return res.status(400).json({ error: 'An active agent needs a connected AI model and a model selection.' });
      }
      const model = await getAiModel(aiModelId);
      if (!model) return res.status(400).json({ error: 'Selected AI model no longer exists.' });
      if (!SUPPORTED_PROVIDERS.has(model.provider)) {
        return res.status(400).json({ error: `Provider '${model.provider}' isn't supported by agents.` });
      }
    } else if (aiModelId) {
      // Draft may still reference a model; validate it if provided.
      const model = await getAiModel(aiModelId);
      if (!model) return res.status(400).json({ error: 'Selected AI model no longer exists.' });
    }
    // Drafts never take live traffic.
    const isActive = status === 'active' ? !!b.isActive : false;

    // Trigger config.
    const triggerMode = b.triggerMode === 'keyword' ? 'keyword' : 'any';
    const triggerKeyword = typeof b.triggerKeyword === 'string' ? b.triggerKeyword.trim().slice(0, 200) : '';
    if (status === 'active' && triggerMode === 'keyword' && !triggerKeyword) {
      return res.status(400).json({ error: 'A keyword-triggered agent needs a keyword.' });
    }
    const mediaGroups = normalizeMediaGroups(b.mediaGroups);

    const { rows } = await pool.query(
      `INSERT INTO coexistence.agents
         (name, description, system_prompt, ai_model_id, llm_model,
          status, wa_account_id, is_active,
          context_window_messages, max_tool_iterations,
          trigger_mode, trigger_keyword, trigger_match_type,
          trigger_case_sensitive, trigger_session_minutes, media_groups,
          transcribe_audio)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
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
      ],
    );
    res.status(201).json(await fetchAgent(rows[0].id));
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Another agent is already active on this WhatsApp account. Disable it first.' });
    }
    console.error('[agents] create error:', err.message);
    res.status(500).json({ error: 'Failed to create agent' });
  }
});

router.put('/agents/:id', adminOnly, async (req, res) => {
  try {
    const b = req.body || {};
    const { rows: existing } = await pool.query(
      'SELECT * FROM coexistence.agents WHERE id = $1',
      [req.params.id],
    );
    if (existing.length === 0) return res.status(404).json({ error: 'Not found' });

    const cur = existing[0];
    // Compute the effective post-update values to validate the draft/active
    // invariant: an active agent (status='active' or taking live traffic) must
    // reference a usable AI model + a chosen model.
    const effStatus    = b.status !== undefined ? (b.status === 'draft' ? 'draft' : 'active') : (cur.status || 'active');
    const effModelId   = b.aiModelId !== undefined ? (b.aiModelId || null) : cur.ai_model_id;
    const effLlmModel  = b.llmModel  !== undefined ? (b.llmModel ? String(b.llmModel).trim() : null) : cur.llm_model;
    let   effIsActive  = b.isActive  !== undefined ? !!b.isActive : cur.is_active;
    if (effStatus === 'draft') effIsActive = false; // drafts never take live traffic

    if (effModelId) {
      const model = await getAiModel(effModelId);
      if (!model) return res.status(400).json({ error: 'Selected AI model no longer exists.' });
      if ((effStatus === 'active' || effIsActive) && !SUPPORTED_PROVIDERS.has(model.provider)) {
        return res.status(400).json({ error: `Provider '${model.provider}' isn't supported by agents.` });
      }
    }
    if ((effStatus === 'active' || effIsActive) && (!effModelId || !effLlmModel)) {
      return res.status(400).json({ error: 'An active agent needs a connected AI model and a model selection.' });
    }

    // A keyword-triggered agent that's going live needs a keyword.
    const effTrigMode = b.triggerMode !== undefined ? (b.triggerMode === 'keyword' ? 'keyword' : 'any') : (cur.trigger_mode || 'any');
    const effTrigKeyword = b.triggerKeyword !== undefined ? String(b.triggerKeyword || '').trim() : (cur.trigger_keyword || '');
    if ((effStatus === 'active' || effIsActive) && effTrigMode === 'keyword' && !effTrigKeyword) {
      return res.status(400).json({ error: 'A keyword-triggered agent needs a keyword.' });
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
    // is_active may be forced false by the draft rule even if the body didn't
    // send it, so push whenever isActive OR status was provided.
    if (b.isActive !== undefined || b.status !== undefined) push('is_active', effIsActive);
    if (b.contextWindowMessages !== undefined) {
      push('context_window_messages', Math.max(1, Math.min(100, parseInt(b.contextWindowMessages, 10) || 20)));
    }
    if (b.transcribeAudio !== undefined) push('transcribe_audio', !!b.transcribeAudio);
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

    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE coexistence.agents SET ${sets.join(', ')} WHERE id = $${i} RETURNING id`,
      params,
    );
    res.json(await fetchAgent(rows[0].id));
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Another agent is already active on this WhatsApp account. Disable it first.' });
    }
    console.error('[agents] update error:', err.message);
    res.status(500).json({ error: 'Failed to update agent' });
  }
});

router.delete('/agents/:id', adminOnly, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM coexistence.agents WHERE id = $1',
      [req.params.id],
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[agents] delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete agent' });
  }
});

/* --------------------------- Tools (nested) --------------------------- */

router.post('/agents/:id/tools', adminOnly, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.toolType || !b.config) {
      return res.status(400).json({ error: 'toolType and config are required' });
    }
    if (b.toolType === 'google_sheets') {
      const cfg = b.config;
      if (!cfg.google_account_id || !cfg.spreadsheet_id || !cfg.sheet_name) {
        return res.status(400).json({ error: 'Sheets tool needs google_account_id, spreadsheet_id, sheet_name' });
      }
      if (!Array.isArray(cfg.ops) || cfg.ops.length === 0) {
        return res.status(400).json({ error: 'Sheets tool needs at least one op enabled (read/append/update)' });
      }
    }
    const { rows } = await pool.query(
      `INSERT INTO coexistence.agent_tools (agent_id, tool_type, config, is_enabled)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, b.toolType, JSON.stringify(b.config), b.isEnabled !== false],
    );
    res.status(201).json(toolShape(rows[0]));
  } catch (err) {
    console.error('[agents] tool create error:', err.message);
    res.status(500).json({ error: 'Failed to add tool' });
  }
});

router.put('/agents/:id/tools/:toolId', adminOnly, async (req, res) => {
  try {
    const b = req.body || {};
    const sets = [];
    const params = [];
    let i = 1;
    if (b.config !== undefined) { sets.push(`config = $${i++}`); params.push(JSON.stringify(b.config)); }
    if (b.isEnabled !== undefined) { sets.push(`is_enabled = $${i++}`); params.push(!!b.isEnabled); }
    if (sets.length === 0) return res.status(400).json({ error: 'No updatable fields provided' });
    params.push(req.params.id, req.params.toolId);
    const { rows } = await pool.query(
      `UPDATE coexistence.agent_tools SET ${sets.join(', ')}
        WHERE agent_id = $${i++} AND id = $${i} RETURNING *`,
      params,
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(toolShape(rows[0]));
  } catch (err) {
    console.error('[agents] tool update error:', err.message);
    res.status(500).json({ error: 'Failed to update tool' });
  }
});

router.delete('/agents/:id/tools/:toolId', adminOnly, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM coexistence.agent_tools WHERE agent_id = $1 AND id = $2',
      [req.params.id, req.params.toolId],
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[agents] tool delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete tool' });
  }
});

/* --------------------------- Runs (viewer) ---------------------------- */

router.get('/agents/:id/runs', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit || '50', 10)));
    const { rows } = await pool.query(
      `SELECT id, agent_id, contact_number, inbound_message_id, status,
              total_input_tokens, total_output_tokens, final_reply, error_message,
              started_at, ended_at
         FROM coexistence.agent_runs
        WHERE agent_id = $1
        ORDER BY started_at DESC
        LIMIT $2`,
      [req.params.id, limit],
    );
    res.json(rows.map(r => ({
      id: r.id,
      agentId: r.agent_id,
      contactNumber: r.contact_number,
      inboundMessageId: r.inbound_message_id,
      status: r.status,
      totalInputTokens: r.total_input_tokens,
      totalOutputTokens: r.total_output_tokens,
      finalReply: r.final_reply,
      errorMessage: r.error_message,
      startedAt: r.started_at,
      endedAt: r.ended_at,
    })));
  } catch (err) {
    console.error('[agents] runs error:', err.message);
    res.status(500).json({ error: 'Failed to fetch runs' });
  }
});

router.get('/agents/:id/runs/:runId', async (req, res) => {
  try {
    const { rows: runs } = await pool.query(
      `SELECT * FROM coexistence.agent_runs WHERE id = $1 AND agent_id = $2`,
      [req.params.runId, req.params.id],
    );
    if (runs.length === 0) return res.status(404).json({ error: 'Not found' });
    const { rows: steps } = await pool.query(
      `SELECT * FROM coexistence.agent_run_steps WHERE run_id = $1 ORDER BY step_index`,
      [req.params.runId],
    );
    const r = runs[0];
    res.json({
      id: r.id,
      agentId: r.agent_id,
      contactNumber: r.contact_number,
      inboundMessageId: r.inbound_message_id,
      status: r.status,
      totalInputTokens: r.total_input_tokens,
      totalOutputTokens: r.total_output_tokens,
      finalReply: r.final_reply,
      errorMessage: r.error_message,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      steps: steps.map(s => ({
        id: s.id,
        stepIndex: s.step_index,
        stepType: s.step_type,
        toolType: s.tool_type,
        input: s.input,
        output: s.output,
        status: s.status,
        latencyMs: s.latency_ms,
        errorMessage: s.error_message,
        createdAt: s.created_at,
      })),
    });
  } catch (err) {
    console.error('[agents] run detail error:', err.message);
    res.status(500).json({ error: 'Failed to fetch run' });
  }
});

/* --------------------------- Test chat (preview) ---------------------- */
const os = require('os');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { runAgentTest, transcribeForAgent } = require('../engine/agentEngine');
const audioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// POST /agents/:id/test  body: { messages: [{role:'user'|'assistant', content}] }
//
// In-app dry run of an agent. Runs the LLM loop with real tool execution
// (Sheets append/read/update WILL hit the real spreadsheet — operators are
// expected to point a test agent at a test sheet) but skips the WhatsApp send
// and skips agent_runs persistence so the run history stays clean. Returns
// the reply text + the per-step trace.
router.post('/agents/:id/test', adminOnly, async (req, res) => {
  try {
    const messages = req.body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages must be a non-empty array of {role,content}' });
    }
    const result = await runAgentTest({ agentId: req.params.id, messages });
    res.json(result);
  } catch (err) {
    console.error('[agents] test error:', err.message);
    res.status(500).json({ error: err.message || 'Agent test failed' });
  }
});

// POST /agents/:id/test/transcribe  (multipart: audio) — transcribe a voice note
// recorded in the test chat, using the agent's OpenAI key. Returns { text }.
router.post('/agents/:id/test/transcribe', adminOnly, audioUpload.single('audio'), async (req, res) => {
  let tmpPath = null;
  try {
    if (!req.file?.buffer?.length) return res.status(400).json({ error: 'No audio uploaded' });
    const mime = req.file.mimetype || '';
    const ext = mime.includes('ogg') ? 'ogg'
      : (mime.includes('mp4') || mime.includes('m4a')) ? 'm4a'
      : mime.includes('mpeg') ? 'mp3'
      : mime.includes('wav') ? 'wav'
      : 'webm';
    tmpPath = path.join(os.tmpdir(), `agent-test-${Date.now()}-${Math.round(Math.random() * 1e6)}.${ext}`);
    fs.writeFileSync(tmpPath, req.file.buffer);
    const text = await transcribeForAgent({ agentId: req.params.id, filePath: tmpPath });
    res.json({ text: text || '' });
  } catch (err) {
    console.error('[agents] test transcribe error:', err.message);
    res.status(500).json({ error: err.message || 'Transcription failed' });
  } finally {
    if (tmpPath) { try { fs.unlinkSync(tmpPath); } catch { /* ignore */ } }
  }
});

module.exports = { router };
