// Sales Pipelines / Deals (Kanban) API.
//
// Role model (mirrors the rest of the app — see middleware/access.js):
//   * admin     — full access: manage pipelines + stages, see ALL deals,
//                 create / edit / delete deals, move any deal.
//   * bda_sales — sees ONLY deals where assigned_user_id = self; may MOVE their
//                 own deals between stages; cannot create / edit / delete, and
//                 cannot touch pipelines or stages.
//
// Pipeline/stage mutations and deal create/edit/delete are gated with the
// shared `adminOnly` middleware. Deal reads are scoped inside the handler, and
// the move endpoint does its own per-deal ownership check for sales users.

const { Router } = require('express');
const pool = require('../db');
const { isAdmin } = require('../permissions');
const { adminOnly, auditLog } = require('../middleware/access');

const router = Router();

const DEFAULT_STAGES = [
  { name: 'New Lead',      probability: 10,  stage_type: 'open', color: '#3B82F6' },
  { name: 'Qualified',     probability: 30,  stage_type: 'open', color: '#EAB308' },
  { name: 'Proposal Sent', probability: 50,  stage_type: 'open', color: '#F97316' },
  { name: 'Negotiation',   probability: 70,  stage_type: 'open', color: '#A855F7' },
  { name: 'Won',           probability: 100, stage_type: 'won',  color: '#16A34A' },
  { name: 'Lost',          probability: 0,   stage_type: 'lost', color: '#DC2626' },
];

/* --------------------------------- shapes -------------------------------- */
function stageShape(r) {
  return {
    id: r.id,
    pipelineId: r.pipeline_id,
    name: r.name,
    probability: r.probability,
    position: r.position,
    stageType: r.stage_type,
    color: r.color,
  };
}
function pipelineShape(r, stages = []) {
  return {
    id: r.id,
    name: r.name,
    isDefault: r.is_default,
    position: r.position,
    stages: stages.map(stageShape),
  };
}
function dealShape(r) {
  return {
    id: r.id,
    pipelineId: r.pipeline_id,
    stageId: r.stage_id,
    title: r.title,
    value: r.value != null ? Number(r.value) : 0,
    currency: r.currency,
    status: r.status,
    assignedUserId: r.assigned_user_id,
    assignedUserName: r.assigned_user_name || null,
    contactWaNumber: r.contact_wa_number,
    contactNumber: r.contact_number,
    contactName: r.contact_name,
    expectedCloseDate: r.expected_close_date,
    notes: r.notes,
    position: r.position,
    wonAt: r.won_at,
    lostAt: r.lost_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function statusForStageType(stageType) {
  if (stageType === 'won') return 'won';
  if (stageType === 'lost') return 'lost';
  return 'open';
}

// Mirror a deal's assignment onto its linked contact so the assignee sees the
// contact (and its whole chat) everywhere — identical effect to assigning from
// the Chats page, because contact list visibility and conversation access
// (assertContactAccess) both gate on contacts.assigned_user_id.
// No-op unless we have a linked contact AND a non-null assignee, so unassigning
// a deal (assignee = NULL) never strips the contact from its current owner.
async function syncContactAssignment(waNumber, contactNumber, assigneeId) {
  if (!waNumber || !contactNumber || !assigneeId) return;
  await pool.query(
    `UPDATE coexistence.contacts
        SET assigned_user_id = $1, updated_at = NOW()
      WHERE wa_number = $2 AND contact_number = $3`,
    [assigneeId, waNumber, contactNumber]
  );
}

/* ------------------------------- pipelines ------------------------------- */

// List all pipelines (with nested stages) — any authenticated user.
router.get('/pipelines', async (req, res) => {
  try {
    const { rows: pipes } = await pool.query(
      'SELECT * FROM coexistence.pipelines ORDER BY is_default DESC, position ASC, id ASC'
    );
    const { rows: stages } = await pool.query(
      'SELECT * FROM coexistence.pipeline_stages ORDER BY position ASC, id ASC'
    );
    const byPipe = new Map();
    stages.forEach(s => {
      if (!byPipe.has(s.pipeline_id)) byPipe.set(s.pipeline_id, []);
      byPipe.get(s.pipeline_id).push(s);
    });
    res.json(pipes.map(p => pipelineShape(p, byPipe.get(p.id) || [])));
  } catch (err) {
    console.error('[pipelines] list error:', err.message);
    res.status(500).json({ error: 'Failed to list pipelines' });
  }
});

// Create a pipeline (+ default stages). Admin only.
router.post('/pipelines', adminOnly, async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Pipeline name is required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: posRows } = await client.query('SELECT COALESCE(MAX(position),-1)+1 AS pos FROM coexistence.pipelines');
    const { rows } = await client.query(
      `INSERT INTO coexistence.pipelines (name, is_default, position, created_by)
       VALUES ($1, FALSE, $2, $3) RETURNING *`,
      [name.trim(), posRows[0].pos, req.user.id]
    );
    const pipe = rows[0];
    for (let i = 0; i < DEFAULT_STAGES.length; i++) {
      const s = DEFAULT_STAGES[i];
      await client.query(
        `INSERT INTO coexistence.pipeline_stages (pipeline_id, name, probability, position, stage_type, color)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [pipe.id, s.name, s.probability, i, s.stage_type, s.color]
      );
    }
    const { rows: stages } = await client.query(
      'SELECT * FROM coexistence.pipeline_stages WHERE pipeline_id = $1 ORDER BY position ASC', [pipe.id]
    );
    await client.query('COMMIT');
    auditLog({ actor: req.user, action: 'pipeline.create', targetType: 'pipeline', targetId: pipe.id, payload: { name: pipe.name } });
    res.status(201).json(pipelineShape(pipe, stages));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[pipelines] create error:', err.message);
    res.status(500).json({ error: 'Failed to create pipeline' });
  } finally {
    client.release();
  }
});

// Rename a pipeline. Admin only.
router.put('/pipelines/:id', adminOnly, async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Pipeline name is required' });
  try {
    const { rows } = await pool.query(
      'UPDATE coexistence.pipelines SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [name.trim(), req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Pipeline not found' });
    res.json(pipelineShape(rows[0]));
  } catch (err) {
    console.error('[pipelines] update error:', err.message);
    res.status(500).json({ error: 'Failed to update pipeline' });
  }
});

// Delete a pipeline (cascades stages + deals). Admin only. Refuses the last one.
router.delete('/pipelines/:id', adminOnly, async (req, res) => {
  try {
    const { rows: cnt } = await pool.query('SELECT COUNT(*)::int AS n FROM coexistence.pipelines');
    if (cnt[0].n <= 1) return res.status(409).json({ error: 'Cannot delete the only pipeline. Create another first.' });
    const { rowCount } = await pool.query('DELETE FROM coexistence.pipelines WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Pipeline not found' });
    auditLog({ actor: req.user, action: 'pipeline.delete', targetType: 'pipeline', targetId: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    console.error('[pipelines] delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete pipeline' });
  }
});

/* --------------------------------- stages -------------------------------- */

// Add a stage to a pipeline. Admin only.
router.post('/pipelines/:id/stages', adminOnly, async (req, res) => {
  const { name, probability, color, stageType } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Stage name is required' });
  const prob = Math.max(0, Math.min(100, parseInt(probability, 10) || 0));
  const type = ['open', 'won', 'lost'].includes(stageType) ? stageType : 'open';
  try {
    const { rows: pipe } = await pool.query('SELECT 1 FROM coexistence.pipelines WHERE id = $1', [req.params.id]);
    if (pipe.length === 0) return res.status(404).json({ error: 'Pipeline not found' });
    const { rows: posRows } = await pool.query(
      'SELECT COALESCE(MAX(position),-1)+1 AS pos FROM coexistence.pipeline_stages WHERE pipeline_id = $1', [req.params.id]
    );
    const { rows } = await pool.query(
      `INSERT INTO coexistence.pipeline_stages (pipeline_id, name, probability, position, stage_type, color)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.id, name.trim(), prob, posRows[0].pos, type, color || null]
    );
    res.status(201).json(stageShape(rows[0]));
  } catch (err) {
    console.error('[pipelines] add stage error:', err.message);
    res.status(500).json({ error: 'Failed to add stage' });
  }
});

// Edit a stage. Admin only.
router.put('/stages/:id', adminOnly, async (req, res) => {
  const { name, probability, color, stageType, position } = req.body || {};
  try {
    const sets = ['updated_at = NOW()'];
    const params = [];
    let i = 1;
    const push = (col, val) => { sets.push(`${col} = $${i++}`); params.push(val); };
    if (name != null) push('name', String(name).trim());
    if (probability != null) push('probability', Math.max(0, Math.min(100, parseInt(probability, 10) || 0)));
    if (color !== undefined) push('color', color || null);
    if (stageType != null && ['open', 'won', 'lost'].includes(stageType)) push('stage_type', stageType);
    if (position != null) push('position', parseInt(position, 10) || 0);
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE coexistence.pipeline_stages SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, params
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Stage not found' });
    res.json(stageShape(rows[0]));
  } catch (err) {
    console.error('[pipelines] update stage error:', err.message);
    res.status(500).json({ error: 'Failed to update stage' });
  }
});

// Delete a stage. Admin only. Refuses if it still holds deals.
router.delete('/stages/:id', adminOnly, async (req, res) => {
  try {
    const { rows: dealCnt } = await pool.query('SELECT COUNT(*)::int AS n FROM coexistence.deals WHERE stage_id = $1', [req.params.id]);
    if (dealCnt[0].n > 0) return res.status(409).json({ error: 'Move or delete the deals in this stage first.' });
    const { rowCount } = await pool.query('DELETE FROM coexistence.pipeline_stages WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Stage not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[pipelines] delete stage error:', err.message);
    res.status(500).json({ error: 'Failed to delete stage' });
  }
});

/* ---------------------------------- deals -------------------------------- */

// Contact search for the optional deal→contact link (admin only — only admins
// create/edit deals). Searches saved contacts by name / profile name / number.
router.get('/deals/contact-search', adminOnly, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
    const like = `%${q}%`;
    const digits = q.replace(/\D/g, '');
    const { rows } = await pool.query(
      `SELECT wa_number, contact_number, COALESCE(name, profile_name) AS name
         FROM coexistence.contacts
        WHERE COALESCE(name,'') ILIKE $1
           OR COALESCE(profile_name,'') ILIKE $1
           OR ($2 <> '' AND contact_number ILIKE $3)
        ORDER BY COALESCE(name, profile_name) NULLS LAST
        LIMIT 15`,
      [like, digits, `%${digits}%`]
    );
    res.json(rows.map(r => ({ waNumber: r.wa_number, contactNumber: r.contact_number, name: r.name })));
  } catch (err) {
    console.error('[pipelines] contact-search error:', err.message);
    res.status(500).json({ error: 'Contact search failed' });
  }
});

// Aggregate KPIs for a pipeline, scoped to what the user can see.
router.get('/deals/metrics', async (req, res) => {
  const pipelineId = req.query.pipelineId;
  if (!pipelineId) return res.status(400).json({ error: 'pipelineId is required' });
  try {
    const params = [pipelineId];
    let scope = '';
    if (!isAdmin(req.user)) { scope = 'AND d.assigned_user_id = $2'; params.push(req.user.id); }
    const { rows } = await pool.query(
      `SELECT
         COUNT(*)                              FILTER (WHERE d.status='open')  AS total_deals,
         COALESCE(SUM(d.value)                 FILTER (WHERE d.status='open'),0) AS pipeline_value,
         COALESCE(AVG(d.value)                 FILTER (WHERE d.status='open'),0) AS avg_deal_size,
         COALESCE(SUM(d.value * s.probability/100.0) FILTER (WHERE d.status='open'),0) AS weighted_value,
         COUNT(*) FILTER (WHERE d.status='won'  AND d.won_at  >= date_trunc('month', NOW())) AS won_this_month,
         COUNT(*) FILTER (WHERE d.status='lost' AND d.lost_at >= date_trunc('month', NOW())) AS lost_this_month
       FROM coexistence.deals d
       JOIN coexistence.pipeline_stages s ON s.id = d.stage_id
       WHERE d.pipeline_id = $1 ${scope}`,
      params
    );
    const m = rows[0];
    res.json({
      totalDeals: Number(m.total_deals),
      pipelineValue: Number(m.pipeline_value),
      avgDealSize: Number(m.avg_deal_size),
      weightedValue: Number(m.weighted_value),
      wonThisMonth: Number(m.won_this_month),
      lostThisMonth: Number(m.lost_this_month),
    });
  } catch (err) {
    console.error('[pipelines] metrics error:', err.message);
    res.status(500).json({ error: 'Failed to load metrics' });
  }
});

// List deals for a pipeline, scoped by role (admin: all; sales: assigned only).
router.get('/deals', async (req, res) => {
  const pipelineId = req.query.pipelineId;
  if (!pipelineId) return res.status(400).json({ error: 'pipelineId is required' });
  try {
    const params = [pipelineId];
    let scope = '';
    if (!isAdmin(req.user)) { scope = 'AND d.assigned_user_id = $2'; params.push(req.user.id); }
    const { rows } = await pool.query(
      `SELECT d.*, COALESCE(u.display_name, u.username) AS assigned_user_name
         FROM coexistence.deals d
         LEFT JOIN coexistence.forgecrm_users u ON u.id = d.assigned_user_id
        WHERE d.pipeline_id = $1 ${scope}
        ORDER BY d.position ASC, d.created_at ASC`,
      params
    );
    res.json(rows.map(dealShape));
  } catch (err) {
    console.error('[pipelines] list deals error:', err.message);
    res.status(500).json({ error: 'Failed to list deals' });
  }
});

// Resolve a stage row that must belong to the given pipeline.
async function getStageInPipeline(stageId, pipelineId) {
  const { rows } = await pool.query(
    'SELECT * FROM coexistence.pipeline_stages WHERE id = $1 AND pipeline_id = $2',
    [stageId, pipelineId]
  );
  return rows[0] || null;
}

// Create a deal. Admin only.
router.post('/deals', adminOnly, async (req, res) => {
  const b = req.body || {};
  if (!b.pipelineId) return res.status(400).json({ error: 'pipelineId is required' });
  if (!b.title || !b.title.trim()) return res.status(400).json({ error: 'Deal title is required' });
  try {
    // Resolve stage: explicit, else the first (lowest-position) stage.
    let stage;
    if (b.stageId) {
      stage = await getStageInPipeline(b.stageId, b.pipelineId);
      if (!stage) return res.status(400).json({ error: 'Stage does not belong to this pipeline' });
    } else {
      const { rows } = await pool.query(
        'SELECT * FROM coexistence.pipeline_stages WHERE pipeline_id = $1 ORDER BY position ASC LIMIT 1', [b.pipelineId]
      );
      stage = rows[0];
      if (!stage) return res.status(400).json({ error: 'Pipeline has no stages' });
    }

    // Default the owner to the linked contact's assignee when not given.
    let assignedUserId = b.assignedUserId || null;
    if (!assignedUserId && b.contactWaNumber && b.contactNumber) {
      const { rows } = await pool.query(
        'SELECT assigned_user_id FROM coexistence.contacts WHERE wa_number = $1 AND contact_number = $2',
        [String(b.contactWaNumber).replace(/\D/g, ''), String(b.contactNumber).replace(/\D/g, '')]
      );
      if (rows[0]) assignedUserId = rows[0].assigned_user_id;
    }

    const status = statusForStageType(stage.stage_type);
    const { rows: posRows } = await pool.query(
      'SELECT COALESCE(MAX(position),-1)+1 AS pos FROM coexistence.deals WHERE stage_id = $1', [stage.id]
    );
    const { rows } = await pool.query(
      `INSERT INTO coexistence.deals
         (pipeline_id, stage_id, title, value, currency, status, assigned_user_id,
          contact_wa_number, contact_number, contact_name, expected_close_date, notes,
          position, won_at, lost_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
               ${status === 'won' ? 'NOW()' : 'NULL'}, ${status === 'lost' ? 'NOW()' : 'NULL'}, $14)
       RETURNING *`,
      [
        b.pipelineId, stage.id, b.title.trim(),
        Number(b.value) || 0, (b.currency || 'INR').trim(), status, assignedUserId,
        b.contactWaNumber ? String(b.contactWaNumber).replace(/\D/g, '') : null,
        b.contactNumber ? String(b.contactNumber).replace(/\D/g, '') : null,
        b.contactName || null,
        b.expectedCloseDate || null, b.notes || null,
        posRows[0].pos, req.user.id,
      ]
    );
    // If this deal links a contact and has an assignee, hand that contact (and
    // its chat) to the assignee — same behaviour as assigning in Chats.
    const created = rows[0];
    await syncContactAssignment(created.contact_wa_number, created.contact_number, created.assigned_user_id);
    res.status(201).json(dealShape(created));
  } catch (err) {
    console.error('[pipelines] create deal error:', err.message);
    res.status(500).json({ error: 'Failed to create deal' });
  }
});

// Edit a deal (full update). Admin only.
router.put('/deals/:id', adminOnly, async (req, res) => {
  const b = req.body || {};
  try {
    const { rows: existing } = await pool.query('SELECT * FROM coexistence.deals WHERE id = $1', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Deal not found' });
    const ex = existing[0];

    // If the stage changes, recompute status / won_at / lost_at.
    let stageId = ex.stage_id;
    let status = ex.status;
    let wonClause = '';
    let lostClause = '';
    if (b.stageId != null && Number(b.stageId) !== Number(ex.stage_id)) {
      const stage = await getStageInPipeline(b.stageId, ex.pipeline_id);
      if (!stage) return res.status(400).json({ error: 'Stage does not belong to this deal\'s pipeline' });
      stageId = stage.id;
      status = statusForStageType(stage.stage_type);
    }

    const sets = ['updated_at = NOW()'];
    const params = [];
    let i = 1;
    const push = (col, val) => { sets.push(`${col} = $${i++}`); params.push(val); };
    if (b.title != null) push('title', String(b.title).trim());
    if (b.value != null) push('value', Number(b.value) || 0);
    if (b.currency != null) push('currency', String(b.currency).trim());
    if (b.assignedUserId !== undefined) push('assigned_user_id', b.assignedUserId || null);
    if (b.contactWaNumber !== undefined) push('contact_wa_number', b.contactWaNumber ? String(b.contactWaNumber).replace(/\D/g, '') : null);
    if (b.contactNumber !== undefined) push('contact_number', b.contactNumber ? String(b.contactNumber).replace(/\D/g, '') : null);
    if (b.contactName !== undefined) push('contact_name', b.contactName || null);
    if (b.expectedCloseDate !== undefined) push('expected_close_date', b.expectedCloseDate || null);
    if (b.notes !== undefined) push('notes', b.notes || null);
    push('stage_id', stageId);
    push('status', status);
    // Stamp won/lost timestamps to match the resulting status.
    sets.push(`won_at = ${status === 'won' ? 'COALESCE(won_at, NOW())' : 'NULL'}`);
    sets.push(`lost_at = ${status === 'lost' ? 'COALESCE(lost_at, NOW())' : 'NULL'}`);
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE coexistence.deals SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, params
    );
    // If the assignee was (re)assigned, mirror it onto the linked contact so the
    // new owner gets the contact + chat too.
    const updated = rows[0];
    if (b.assignedUserId !== undefined) {
      await syncContactAssignment(updated.contact_wa_number, updated.contact_number, updated.assigned_user_id);
    }
    res.json(dealShape(updated));
  } catch (err) {
    console.error('[pipelines] update deal error:', err.message);
    res.status(500).json({ error: 'Failed to update deal' });
  }
});

// Move a deal to a stage. Admin: any deal. Sales: only their own assigned deal.
router.post('/deals/:id/move', async (req, res) => {
  const { stageId } = req.body || {};
  if (!stageId) return res.status(400).json({ error: 'stageId is required' });
  try {
    const { rows: existing } = await pool.query('SELECT * FROM coexistence.deals WHERE id = $1', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Deal not found' });
    const ex = existing[0];

    // Sales users may only move deals assigned to them.
    if (!isAdmin(req.user) && Number(ex.assigned_user_id) !== Number(req.user.id)) {
      return res.status(403).json({ error: 'You can only move deals assigned to you' });
    }

    const stage = await getStageInPipeline(stageId, ex.pipeline_id);
    if (!stage) return res.status(400).json({ error: 'Stage does not belong to this deal\'s pipeline' });
    const status = statusForStageType(stage.stage_type);
    const { rows: posRows } = await pool.query(
      'SELECT COALESCE(MAX(position),-1)+1 AS pos FROM coexistence.deals WHERE stage_id = $1', [stage.id]
    );
    const { rows } = await pool.query(
      `UPDATE coexistence.deals
          SET stage_id = $1, status = $2, position = $3, updated_at = NOW(),
              won_at  = ${status === 'won' ? 'COALESCE(won_at, NOW())' : 'NULL'},
              lost_at = ${status === 'lost' ? 'COALESCE(lost_at, NOW())' : 'NULL'}
        WHERE id = $4 RETURNING *`,
      [stage.id, status, posRows[0].pos, req.params.id]
    );
    res.json(dealShape(rows[0]));
  } catch (err) {
    console.error('[pipelines] move deal error:', err.message);
    res.status(500).json({ error: 'Failed to move deal' });
  }
});

// Delete a deal. Admin only.
router.delete('/deals/:id', adminOnly, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM coexistence.deals WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Deal not found' });
    auditLog({ actor: req.user, action: 'deal.delete', targetType: 'deal', targetId: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    console.error('[pipelines] delete deal error:', err.message);
    res.status(500).json({ error: 'Failed to delete deal' });
  }
});

module.exports = { router };
