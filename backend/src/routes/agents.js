// AI Agents CRUD + runs viewer.
//
// Single-owner system, same pattern as whatsappAccounts.js: every authenticated
// request is the owner. BYOK API keys are AES-256-GCM at rest (util/crypto.js)
// and never returned in plaintext except via ?reveal=1 on the single-agent
// GET, mirroring how access tokens are revealed elsewhere.

const { Router } = require('express');
const pool = require('../db');
const { encrypt, decrypt, maskSecret } = require('../util/crypto');

const router = Router();

function adminOnly(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function agentShape(row, { reveal = false } = {}) {
  if (!row) return null;
  const apiKey = decrypt(row.llm_api_key_encrypted);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    systemPrompt: row.system_prompt,
    llmProvider: row.llm_provider,
    llmModel: row.llm_model,
    llmApiKeyMasked: maskSecret(apiKey || ''),
    llmApiKey: reveal ? (apiKey || '') : undefined,
    hasOwnApiKey: !!apiKey,
    waAccountId: row.wa_account_id,
    isActive: row.is_active,
    contextWindowMessages: row.context_window_messages,
    maxToolIterations: row.max_tool_iterations,
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

router.get('/agents', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.*,
              (SELECT COUNT(*)::int FROM coexistence.agent_tools t WHERE t.agent_id = a.id) AS tool_count,
              (SELECT MAX(started_at) FROM coexistence.agent_runs r WHERE r.agent_id = a.id) AS last_run_at
         FROM coexistence.agents a
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
      'SELECT * FROM coexistence.agents WHERE id = $1',
      [req.params.id],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });

    const { rows: tools } = await pool.query(
      `SELECT * FROM coexistence.agent_tools WHERE agent_id = $1 ORDER BY id`,
      [req.params.id],
    );
    res.json({
      ...agentShape(rows[0], { reveal: req.query.reveal === '1' }),
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
    if (!b.name || !b.systemPrompt || !b.llmProvider || !b.llmModel) {
      return res.status(400).json({ error: 'name, systemPrompt, llmProvider, llmModel are required' });
    }
    if (!['anthropic', 'openai'].includes(b.llmProvider)) {
      return res.status(400).json({ error: "llmProvider must be 'anthropic' or 'openai'" });
    }
    const { rows } = await pool.query(
      `INSERT INTO coexistence.agents
         (name, description, system_prompt, llm_provider, llm_model,
          llm_api_key_encrypted, wa_account_id, is_active,
          context_window_messages, max_tool_iterations)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        b.name.trim(), b.description?.trim() || null,
        b.systemPrompt, b.llmProvider, b.llmModel.trim(),
        b.llmApiKey ? encrypt(b.llmApiKey.trim()) : null,
        b.waAccountId || null,
        !!b.isActive,
        Math.max(1, Math.min(100, parseInt(b.contextWindowMessages || 20, 10))),
        Math.max(1, Math.min(20, parseInt(b.maxToolIterations || 6, 10))),
      ],
    );
    res.status(201).json(agentShape(rows[0]));
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

    const sets = ['updated_at = NOW()'];
    const params = [];
    let i = 1;
    const push = (col, val) => { sets.push(`${col} = $${i++}`); params.push(val); };

    if (b.name !== undefined) push('name', b.name.trim());
    if (b.description !== undefined) push('description', b.description?.trim() || null);
    if (b.systemPrompt !== undefined) push('system_prompt', b.systemPrompt);
    if (b.llmProvider !== undefined) {
      if (!['anthropic', 'openai'].includes(b.llmProvider)) {
        return res.status(400).json({ error: "llmProvider must be 'anthropic' or 'openai'" });
      }
      push('llm_provider', b.llmProvider);
    }
    if (b.llmModel !== undefined) push('llm_model', b.llmModel.trim());
    // Treat an empty string as "clear my key, fall back to server env"; null/undefined
    // means "no change"; any other string means "rotate to this new key".
    if (b.llmApiKey !== undefined) {
      if (b.llmApiKey === '') push('llm_api_key_encrypted', null);
      else push('llm_api_key_encrypted', encrypt(b.llmApiKey.trim()));
    }
    if (b.waAccountId !== undefined) push('wa_account_id', b.waAccountId || null);
    if (b.isActive !== undefined) push('is_active', !!b.isActive);
    if (b.contextWindowMessages !== undefined) {
      push('context_window_messages', Math.max(1, Math.min(100, parseInt(b.contextWindowMessages, 10) || 20)));
    }
    if (b.maxToolIterations !== undefined) {
      push('max_tool_iterations', Math.max(1, Math.min(20, parseInt(b.maxToolIterations, 10) || 6)));
    }

    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE coexistence.agents SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      params,
    );
    res.json(agentShape(rows[0]));
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

module.exports = { router };
