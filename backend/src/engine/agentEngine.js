// Agent engine: end-to-end "inbound message → LLM tool-use loop → outbound reply".
//
// Called from the agentQueue worker (NOT inline from the webhook) so the
// webhook stays under Meta's 20s timeout. Logs everything to agent_runs +
// agent_run_steps so the UI can show a full trace.

const pool = require('../db');
const { decrypt } = require('../util/crypto');
const { getProvider } = require('../llm');
const googleSheets = require('../services/googleSheets');
const { enqueueSend } = require('../queue/sendQueue');
const { getAccountWithToken } = require('../routes/whatsappAccounts');

/**
 * Build the JSON-schema tool definitions surfaced to the LLM for one agent.
 * Returns:
 *   - tools: array of { name, description, input_schema } (Anthropic shape)
 *   - executors: map from tool name → async (args) => result
 *
 * We name tools deterministically as `<tool_type>_<op>` (e.g. `google_sheets_append`)
 * so the LLM can pick the right one and so multiple Sheets tools per agent
 * (different spreadsheets) get unique names via the row id suffix.
 */
async function buildToolsForAgent(agentId) {
  const { rows } = await pool.query(
    `SELECT * FROM coexistence.agent_tools
      WHERE agent_id = $1 AND is_enabled = TRUE
      ORDER BY id`,
    [agentId],
  );

  const tools = [];
  const executors = {};

  for (const row of rows) {
    if (row.tool_type === 'google_sheets') {
      const cfg = row.config || {};
      const ops = Array.isArray(cfg.ops) ? cfg.ops : [];
      const baseDesc = `Google Sheet "${cfg.spreadsheet_name || cfg.spreadsheet_id}" tab "${cfg.sheet_name}"`;

      if (ops.includes('read')) {
        const name = `google_sheets_read_${row.id}`;
        tools.push({
          name,
          description: `Read rows from ${baseDesc}. Use this to look up information the user might be asking about.`,
          input_schema: {
            type: 'object',
            properties: {
              range: {
                type: 'string',
                description: "Optional A1 range to read (e.g. 'A2:E50'). Omit to read the whole sheet.",
              },
              max_rows: {
                type: 'integer',
                description: 'Cap the number of rows returned. Default 100, max 500.',
              },
            },
          },
        });
        executors[name] = (args) => googleSheets.executeOp({ op: 'read', toolConfig: cfg, args });
      }

      if (ops.includes('append')) {
        const name = `google_sheets_append_${row.id}`;
        tools.push({
          name,
          description: `Append a new row to ${baseDesc}. Use this to save information the user provided (booking, order, lead, etc.).`,
          input_schema: {
            type: 'object',
            properties: {
              values: {
                type: 'array',
                items: { type: ['string', 'number', 'boolean', 'null'] },
                description: 'Cell values in left-to-right column order.',
              },
            },
            required: ['values'],
          },
        });
        executors[name] = (args) => googleSheets.executeOp({ op: 'append', toolConfig: cfg, args });
      }

      if (ops.includes('update')) {
        const name = `google_sheets_update_${row.id}`;
        tools.push({
          name,
          description: `Update a specific range in ${baseDesc}. Use this only after you've used the read tool to identify which row/range to change.`,
          input_schema: {
            type: 'object',
            properties: {
              range: {
                type: 'string',
                description: "A1 range to overwrite (e.g. 'A5:E5' to replace row 5).",
              },
              values: {
                type: 'array',
                items: { type: ['string', 'number', 'boolean', 'null'] },
                description: 'New cell values for the range.',
              },
            },
            required: ['range', 'values'],
          },
        });
        executors[name] = (args) => googleSheets.executeOp({ op: 'update', toolConfig: cfg, args });
      }
    }
    // Future: gmail_send, calendar_create_event, etc. — same pattern.
  }

  return { tools, executors };
}

/**
 * Pull recent chat history for this contact, oldest-first, capped at the
 * agent's context window. Skips status updates and reactions.
 */
async function buildMessageHistory({ waAccountId, contactNumber, limit, currentInboundText }) {
  // Resolve the agent's wa_number from the WhatsApp account
  let waNumber = null;
  if (waAccountId) {
    const acc = await getAccountWithToken(waAccountId);
    waNumber = acc?.displayPhoneNumber || null;
  }

  const { rows } = waNumber
    ? await pool.query(
        `SELECT direction, message_body, timestamp
           FROM coexistence.chat_history
          WHERE wa_number = $1 AND contact_number = $2
            AND message_type NOT IN ('status','reaction')
            AND message_body IS NOT NULL AND message_body <> ''
          ORDER BY timestamp DESC
          LIMIT $3`,
        [waNumber, contactNumber, Math.max(1, Math.min(100, limit || 20))],
      )
    : { rows: [] };

  // DB returned newest-first for the LIMIT; reverse to chronological.
  const history = rows.reverse().map(r => ({
    role: r.direction === 'incoming' ? 'user' : 'assistant',
    content: r.message_body,
  }));

  // The current inbound message may not yet be persisted (timing race vs.
  // webhook commit). Append it as the last user message if it isn't there.
  const last = history[history.length - 1];
  if (currentInboundText && !(last && last.role === 'user' && last.content === currentInboundText)) {
    history.push({ role: 'user', content: currentInboundText });
  }
  return history;
}

function pickApiKey(agent) {
  const fromAgent = decrypt(agent.llm_api_key_encrypted);
  if (fromAgent) return fromAgent;
  if (agent.llm_provider === 'anthropic') return process.env.ANTHROPIC_API_KEY || '';
  if (agent.llm_provider === 'openai')    return process.env.OPENAI_API_KEY || '';
  return '';
}

async function recordStep(runId, stepIndex, step) {
  await pool.query(
    `INSERT INTO coexistence.agent_run_steps
       (run_id, step_index, step_type, tool_type, input, output, status, latency_ms, error_message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      runId,
      stepIndex,
      step.step_type,
      step.tool_type || null,
      step.input ? JSON.stringify(step.input) : null,
      step.output != null ? JSON.stringify(step.output) : null,
      step.status,
      step.latency_ms || null,
      step.error_message ? String(step.error_message).slice(0, 1000) : null,
    ],
  );
}

/**
 * Main entry. Loads the agent, builds tools + context, runs the LLM loop,
 * persists everything, and enqueues the final reply on the existing sendQueue.
 */
async function runAgent({ agentId, contactNumber, inboundMessageId, inboundText }) {
  const { rows: agentRows } = await pool.query(
    'SELECT * FROM coexistence.agents WHERE id = $1',
    [agentId],
  );
  const agent = agentRows[0];
  if (!agent) throw new Error(`Agent id=${agentId} not found`);
  if (!agent.is_active) throw new Error(`Agent id=${agentId} is inactive`);
  if (!agent.wa_account_id) throw new Error(`Agent id=${agentId} has no WhatsApp account bound`);

  const apiKey = pickApiKey(agent);
  if (!apiKey) {
    throw new Error(`No API key for provider '${agent.llm_provider}'. Set a per-agent key, or ${agent.llm_provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} in backend/.env.`);
  }

  // Open the run row immediately so a crash mid-loop is still visible in the UI.
  const { rows: runRows } = await pool.query(
    `INSERT INTO coexistence.agent_runs
       (agent_id, wa_account_id, contact_number, inbound_message_id, status)
     VALUES ($1,$2,$3,$4,'running')
     RETURNING id`,
    [agent.id, agent.wa_account_id, contactNumber, inboundMessageId || null],
  );
  const runId = runRows[0].id;

  let stepCounter = 0;
  const onStep = async (step) => {
    stepCounter += 1;
    try {
      await recordStep(runId, stepCounter, step);
    } catch (e) {
      console.error('[agentEngine] step persist failed:', e.message);
    }
  };

  try {
    const { tools, executors } = await buildToolsForAgent(agent.id);
    const history = await buildMessageHistory({
      waAccountId: agent.wa_account_id,
      contactNumber,
      limit: agent.context_window_messages,
      currentInboundText: inboundText,
    });

    const provider = getProvider(agent.llm_provider);
    const result = await provider.runWithTools({
      systemPrompt: agent.system_prompt,
      messages: history,
      tools,
      onToolCall: async ({ name, args }) => {
        const exec = executors[name];
        if (!exec) throw new Error(`Unknown tool '${name}'`);
        return await exec(args);
      },
      onStep,
      model: agent.llm_model,
      apiKey,
      maxIterations: Math.max(1, Math.min(20, agent.max_tool_iterations || 6)),
    });

    const finalStatus = result.capped ? 'capped' : 'completed';
    await pool.query(
      `UPDATE coexistence.agent_runs
          SET status=$1, total_input_tokens=$2, total_output_tokens=$3,
              final_reply=$4, ended_at=NOW()
        WHERE id=$5`,
      [finalStatus, result.totalInputTokens, result.totalOutputTokens,
       result.finalText || null, runId],
    );

    if (result.finalText) {
      await enqueueSend({
        kind: 'text',
        accountId: agent.wa_account_id,
        to: contactNumber,
        payload: { body: result.finalText },
      });
    }
    return { runId, status: finalStatus, finalText: result.finalText };
  } catch (err) {
    await pool.query(
      `UPDATE coexistence.agent_runs
          SET status='failed', error_message=$1, ended_at=NOW()
        WHERE id=$2`,
      [String(err.message || err).slice(0, 1000), runId],
    );
    throw err;
  }
}

module.exports = { runAgent, buildToolsForAgent, buildMessageHistory };
