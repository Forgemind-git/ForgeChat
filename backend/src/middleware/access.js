// Role / permission enforcement and audit logging.
//
// The JWT only carries { id, username, displayName, role } — for permission
// checks against the optional per-user overrides we re-load the row.

const pool = require('../db');
const { effectivePages, isAdmin, hasPermission } = require('../permissions');

// adminOnly: simple gate on req.user.role
function adminOnly(req, res, next) {
  if (!isAdmin(req.user)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// requirePermission(page): gates a route on whether the current user can
// reach `page`. Loads the user row fresh so per-user overrides are honoured.
function requirePermission(page) {
  return async (req, res, next) => {
    try {
      if (isAdmin(req.user)) return next();
      const { rows } = await pool.query(
        `SELECT role, permissions FROM coexistence.forgecrm_users WHERE id = $1`,
        [req.user.id]
      );
      const u = rows[0];
      if (!u) return res.status(401).json({ error: 'User not found' });
      if (!hasPermission({ role: u.role, permissions: u.permissions }, page)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      next();
    } catch (err) {
      console.error('[access] requirePermission error:', err.message);
      res.status(500).json({ error: 'Permission check failed' });
    }
  };
}

// Look up the WA numbers a user is allowed to see. Admin gets null
// (meaning "no scoping needed"). Non-admins get the array — may be empty.
async function userWaNumbers(userId) {
  const { rows } = await pool.query(
    `SELECT wa_number FROM coexistence.user_wa_assignments WHERE user_id = $1`,
    [userId]
  );
  return rows.map(r => r.wa_number);
}

// Build a SQL fragment + params to scope a query to "rows visible to req.user".
// Used by read endpoints (messages, contacts, numbers). The fragment is a
// boolean expression; the caller injects it into their WHERE.
//
//   const scope = await buildWaScope(req, '{table_alias}', paramIndex);
//   if (scope.sql) { whereClauses.push(scope.sql); params.push(...scope.params); }
//
// `tableAlias.wa_number` and `tableAlias.contact_number` must exist on the
// table being scoped (true for chat_history, contacts, and the derived
// messages/numbers/contact-names queries).
//
// Returns { sql, params }. `sql` is empty string when scoping is unnecessary
// (admin, or non-scopable route).
async function buildWaScope(req, tableAlias, startParamIndex) {
  if (isAdmin(req.user)) return { sql: '', params: [] };
  const waNumbers = await userWaNumbers(req.user.id);
  if (waNumbers.length === 0) {
    // BDA with no assignments → see nothing
    return { sql: 'FALSE', params: [] };
  }
  // Scope: row's wa_number is in the user's list,
  //   OR the contact has an explicit assigned_user_id matching this user
  //      (handled via subquery against the contacts table).
  const waParam = `$${startParamIndex}`;
  const userParam = `$${startParamIndex + 1}`;
  const sql = `(
    ${tableAlias}.wa_number = ANY(${waParam}::text[])
    OR EXISTS (
      SELECT 1 FROM coexistence.contacts c
       WHERE c.wa_number = ${tableAlias}.wa_number
         AND c.contact_number = ${tableAlias}.contact_number
         AND c.assigned_user_id = ${userParam}
    )
  )`;
  return { sql, params: [waNumbers, req.user.id] };
}

// Convenience: assert the current user has access to a specific wa_number.
// Admin always passes. Non-admin: must have at least one assigned contact on
// this wa_number (assigned_user_id = req.user.id). This is the *number-level*
// visibility check — to also gate a specific conversation, use
// `assertContactAccess(waNumber, contactNumber)` below.
async function assertWaAccess(req, res, waNumber) {
  if (isAdmin(req.user)) return true;
  const clean = String(waNumber || '').replace(/\D/g, '');
  const { rows } = await pool.query(
    `SELECT 1 FROM coexistence.contacts
      WHERE wa_number = $1 AND assigned_user_id = $2 LIMIT 1`,
    [clean, req.user.id]
  );
  if (rows.length === 0) {
    res.status(403).json({ error: 'You do not have access to this WhatsApp number' });
    return false;
  }
  return true;
}

// Per-conversation access: the (wa_number, contact_number) pair must be a
// contact whose assigned_user_id matches the current user. Admin bypasses.
async function assertContactAccess(req, res, waNumber, contactNumber) {
  if (isAdmin(req.user)) return true;
  const cleanWa = String(waNumber || '').replace(/\D/g, '');
  const cleanContact = String(contactNumber || '').replace(/\D/g, '');
  const { rows } = await pool.query(
    `SELECT 1 FROM coexistence.contacts
      WHERE wa_number = $1 AND contact_number = $2 AND assigned_user_id = $3 LIMIT 1`,
    [cleanWa, cleanContact, req.user.id]
  );
  if (rows.length === 0) {
    res.status(403).json({ error: 'You do not have access to this conversation' });
    return false;
  }
  return true;
}

// Append-only audit log of admin-sensitive actions.
async function auditLog({ actor, action, targetType = null, targetId = null, payload = null }) {
  try {
    await pool.query(
      `INSERT INTO coexistence.user_audit_log
         (actor_user_id, actor_username, action, target_type, target_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        actor?.id || null,
        actor?.username || null,
        action,
        targetType,
        targetId != null ? String(targetId) : null,
        payload ? JSON.stringify(payload) : null,
      ]
    );
  } catch (err) {
    // Audit logging must never break the calling request
    console.error('[audit] write failed:', err.message);
  }
}

module.exports = {
  adminOnly,
  requirePermission,
  userWaNumbers,
  buildWaScope,
  assertWaAccess,
  assertContactAccess,
  auditLog,
};
