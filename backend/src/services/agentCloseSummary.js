// Close-summary sweeper. Finds conversations that an idle-summary agent ran on
// but have since gone quiet (no new message for the agent's idle window) and
// aren't being handled by a human, then asks the agent to write its final
// summary. Runs on a timer from index.js.

const pool = require('../db');

async function sweepClosedConversations() {
  const { rows } = await pool.query(
    `SELECT c.wa_number, c.contact_number, a.id AS agent_id
       FROM coexistence.contacts c
       JOIN coexistence.whatsapp_accounts w
         ON regexp_replace(w.display_phone_number, '\\D', '', 'g') = regexp_replace(c.wa_number, '\\D', '', 'g')
       JOIN coexistence.agents a
         ON a.wa_account_id = w.id AND a.is_active = TRUE AND a.close_summary_enabled = TRUE
      WHERE c.agent_close_pending = TRUE
        AND c.agent_paused = FALSE
        AND c.agent_last_run_at IS NOT NULL
        AND c.agent_last_run_at < NOW() - make_interval(mins => GREATEST(1, a.close_idle_minutes))
      LIMIT 10`,
  );

  let done = 0;
  for (const r of rows) {
    // Claim atomically so concurrent sweeps don't double-summarise.
    const { rowCount } = await pool.query(
      `UPDATE coexistence.contacts SET agent_close_pending = FALSE
        WHERE wa_number = $1 AND contact_number = $2 AND agent_close_pending = TRUE`,
      [r.wa_number, r.contact_number],
    );
    if (!rowCount) continue;
    try {
      const { runCloseSummary } = require('../engine/agentEngine');
      await runCloseSummary({ agentId: r.agent_id, waNumber: r.wa_number, contactNumber: r.contact_number });
      done++;
    } catch (e) {
      console.error('[closeSummary] sweep failed for', r.contact_number, e.message);
    }
  }
  return done;
}

module.exports = { sweepClosedConversations };
