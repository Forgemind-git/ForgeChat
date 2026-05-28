// Agent router. Called from the webhook after evaluateTriggers() returns.
// Decides whether to hand an inbound message to the active agent for that
// WhatsApp account.
//
// Precedence (handled by the caller):
//   1. Paused automation execution awaiting a reply → resume that, skip agent.
//   2. Keyword automation fires on this message → run it, skip agent.
//   3. Otherwise → this router enqueues the agent run (if any agent is active
//      for the inbound WA number).

const pool = require('../db');
const { enqueueAgentRun } = require('../queue/agentQueue');

/**
 * Look up the active agent (if any) for the WhatsApp account that received
 * `record`, and enqueue a run. Returns the run job's metadata or null.
 *
 * - Matches the WA account by its display_phone_number (digits-only) against
 *   the inbound record's wa_number; falls back to phone_number_id.
 * - The DB enforces at most one active agent per WA account (partial unique
 *   index on agents(wa_account_id) WHERE is_active=TRUE), so this query is
 *   guaranteed to return ≤1 row.
 */
async function routeIfActive(record) {
  if (!record || record.direction !== 'incoming') return null;
  if (record.message_type === 'status' || record.message_type === 'reaction') return null;
  if (!record.message_body || !record.contact_number) return null;

  const { rows } = await pool.query(
    `SELECT a.id, a.wa_account_id
       FROM coexistence.agents a
       JOIN coexistence.whatsapp_accounts w ON w.id = a.wa_account_id
      WHERE a.is_active = TRUE
        AND (regexp_replace(w.display_phone_number, '\\D', '', 'g') = $1
             OR w.phone_number_id = $2)
      LIMIT 1`,
    [record.wa_number || '', record.phone_number_id || ''],
  );
  if (rows.length === 0) return null;

  const agent = rows[0];
  await enqueueAgentRun({
    agentId: agent.id,
    contactNumber: record.contact_number,
    inboundMessageId: record.message_id || null,
    inboundText: record.message_body,
  });
  return { agentId: agent.id };
}

module.exports = { routeIfActive };
