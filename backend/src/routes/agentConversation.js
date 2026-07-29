// Per-conversation agent controls for the Chats UI: is the bot active here, and
// the manual "take over" / "return to bot" switch. BDA-accessible (gated by
// assertContactAccess), unlike the admin-only agent CRUD in routes/agents.js.

const { Router } = require('express');
const pool = require('../db');
const { assertContactAccess } = require('../middleware/access');
const { performHandoff, resumeAgent } = require('../services/agentHandoff');

const router = Router();

// Find the active agent (if any) bound to the WhatsApp number of a contact.
async function activeAgentForWaNumber(waNumber) {
  const { rows } = await pool.query(
    `SELECT a.id, a.name
       FROM coexistence.agents a
       JOIN coexistence.whatsapp_accounts w ON w.id = a.wa_account_id
      WHERE a.is_active = TRUE
        AND regexp_replace(w.display_phone_number, '\\D', '', 'g') = regexp_replace($1, '\\D', '', 'g')
      LIMIT 1`,
    [waNumber || ''],
  );
  return rows[0] || null;
}

// GET /api/agent-conversation?waNumber=&contactNumber=
// → { hasAgent, agentId, agentName, paused, pausedBy, pausedReason, pausedAt }
router.get('/agent-conversation', async (req, res) => {
  const waNumber = String(req.query.waNumber || '');
  const contactNumber = String(req.query.contactNumber || '');
  if (!waNumber || !contactNumber) return res.status(400).json({ error: 'waNumber and contactNumber are required' });
  if (!(await assertContactAccess(req, res, waNumber, contactNumber))) return;
  try {
    const agent = await activeAgentForWaNumber(waNumber);
    const { rows } = await pool.query(
      `SELECT agent_paused, agent_paused_by, agent_paused_reason, agent_paused_at
         FROM coexistence.contacts WHERE wa_number = $1 AND contact_number = $2`,
      [waNumber, contactNumber],
    );
    const c = rows[0] || {};
    res.json({
      hasAgent: !!agent,
      agentId: agent?.id || null,
      agentName: agent?.name || null,
      paused: !!c.agent_paused,
      pausedBy: c.agent_paused_by || null,
      pausedReason: c.agent_paused_reason || null,
      pausedAt: c.agent_paused_at || null,
    });
  } catch (err) {
    console.error('[agent-conversation] status error:', err.message);
    res.status(500).json({ error: 'Failed to load agent status' });
  }
});

// POST /api/agent-conversation/pause  { waNumber, contactNumber }  — take over.
router.post('/agent-conversation/pause', async (req, res) => {
  const { waNumber, contactNumber } = req.body || {};
  if (!waNumber || !contactNumber) return res.status(400).json({ error: 'waNumber and contactNumber are required' });
  if (!(await assertContactAccess(req, res, waNumber, contactNumber))) return;
  try {
    const agent = await activeAgentForWaNumber(waNumber);
    if (!agent) return res.status(400).json({ error: 'No active AI agent on this number.' });
    const who = req.user?.displayName || req.user?.username || `user ${req.user?.id}`;
    const r = await performHandoff({
      agentId: agent.id, handoffUserIds: [], waNumber, contactNumber,
      reason: `Taken over by ${who}`, by: `manual:${req.user?.id}`, assignTo: req.user?.id,
    });
    res.json({ ok: true, paused: true, assignedUserId: r.assignedUserId, assignedUserName: r.assignedUserName });
  } catch (err) {
    console.error('[agent-conversation] pause error:', err.message);
    res.status(500).json({ error: 'Failed to take over the conversation' });
  }
});

// POST /api/agent-conversation/resume  { waNumber, contactNumber }  — return to bot.
router.post('/agent-conversation/resume', async (req, res) => {
  const { waNumber, contactNumber } = req.body || {};
  if (!waNumber || !contactNumber) return res.status(400).json({ error: 'waNumber and contactNumber are required' });
  if (!(await assertContactAccess(req, res, waNumber, contactNumber))) return;
  try {
    await resumeAgent({ waNumber, contactNumber, by: `manual:${req.user?.id}` });
    res.json({ ok: true, paused: false });
  } catch (err) {
    console.error('[agent-conversation] resume error:', err.message);
    res.status(500).json({ error: 'Failed to return the conversation to the bot' });
  }
});

module.exports = { router };
