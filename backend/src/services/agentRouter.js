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

// Keyword matcher — mirrors automationEngine's matchesKeyword so the agent's
// keyword trigger behaves identically to a keyword automation's.
function normalizeText(t) { return (t || '').toLowerCase().trim(); }
function matchesKeyword(messageBody, keyword, matchType, caseSensitive) {
  if (!messageBody || !keyword) return false;
  const msg = caseSensitive ? String(messageBody).trim() : normalizeText(messageBody);
  const kw = caseSensitive ? String(keyword).trim() : normalizeText(keyword);
  if (!kw) return false;
  switch (matchType) {
    case 'contains': return msg.includes(kw);
    case 'starts': return msg.startsWith(kw);
    case 'exact':
    default: return msg === kw;
  }
}

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
  if (!record.contact_number) return null;

  const isAudio = (record.message_type === 'audio' || record.message_type === 'voice') && !!record.media_url;
  // Audio/voice inbounds carry a placeholder body ("Audio message" / "Voice
  // message") set by the webhook — never a real caption (WhatsApp audio has no
  // caption field). Treat them as text-less so the transcribe_audio gate below
  // is actually honoured and the worker transcribes the audio instead of
  // running the agent on the literal placeholder string.
  const hasText = !isAudio && !!(record.message_body && record.message_body.trim());
  if (!hasText && !isAudio) return null; // only text or voice notes are actionable

  const { rows } = await pool.query(
    `SELECT a.id, a.wa_account_id, a.trigger_mode, a.trigger_keyword,
            a.trigger_match_type, a.trigger_case_sensitive, a.trigger_session_minutes,
            a.transcribe_audio
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

  // A voice note only runs when the agent has transcription enabled (the worker
  // turns it into text via Whisper). Otherwise the agent stays text-only.
  if (isAudio && !hasText && !agent.transcribe_audio) return null;

  // Trigger gating. 'any' = run on every inbound. 'keyword' = engage on a
  // keyword match OR an active session. A voice note can't be keyword-matched
  // before it's transcribed, so in keyword mode it's handled only within an
  // active session (after a keyword already engaged the agent).
  if ((agent.trigger_mode || 'any') === 'keyword') {
    const matched = hasText && matchesKeyword(
      record.message_body, agent.trigger_keyword,
      agent.trigger_match_type, agent.trigger_case_sensitive,
    );
    if (!matched) {
      const windowMin = agent.trigger_session_minutes || 30;
      const { rows: recent } = await pool.query(
        `SELECT 1 FROM coexistence.agent_runs
          WHERE agent_id = $1 AND contact_number = $2
            AND started_at > NOW() - make_interval(mins => $3)
          LIMIT 1`,
        [agent.id, record.contact_number, windowMin],
      );
      if (recent.length === 0) return null; // no keyword match and no live session
    }
  }

  await enqueueAgentRun({
    agentId: agent.id,
    contactNumber: record.contact_number,
    inboundMessageId: record.message_id || null,
    inboundText: hasText ? record.message_body : null,
  });
  return { agentId: agent.id };
}

module.exports = { routeIfActive };
