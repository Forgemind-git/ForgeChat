const { Router } = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const pool = require('./db');
const { effectivePages } = require('./permissions');

// Build the full session for a user: identity + role + the resolved page list
// + the WhatsApp numbers they're assigned to. The frontend uses `pages` to
// gate nav/routes and `role` to decide admin-only UI.
async function loadUserSession(userId) {
  const { rows } = await pool.query(
    `SELECT id, username, email, display_name, role, permissions, is_active, last_login_at
       FROM coexistence.forgecrm_users WHERE id = $1`,
    [userId]
  );
  const u = rows[0];
  if (!u) return null;
  const { rows: waRows } = await pool.query(
    `SELECT wa_number FROM coexistence.user_wa_assignments WHERE user_id = $1`,
    [userId]
  );
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    displayName: u.display_name,
    role: u.role,
    isActive: u.is_active,
    permissions: u.permissions || null,
    pages: Array.from(effectivePages({ role: u.role, permissions: u.permissions })),
    assignedWaNumbers: waRows.map(r => r.wa_number),
  };
}

const JWT_SECRET = process.env.JWT_SECRET || 'forgecrm-dev-secret-change-me';
// In production, refuse to start with a missing or default signing secret —
// otherwise auth tokens could be forged using the well-known default (the
// source is public). Dev/test keep the convenient fallback.
if (process.env.NODE_ENV === 'production' &&
    (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'forgecrm-dev-secret-change-me')) {
  console.error('[auth] FATAL: JWT_SECRET must be set to a strong, unique value in production.');
  process.exit(1);
}
const COOKIE_NAME = 'forgecrm_token';
const TOKEN_EXPIRY = '24h';

const router = Router();

// Ensure tables exist on startup
async function ensureTables() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS coexistence.forgecrm_users (
        id         BIGSERIAL PRIMARY KEY,
        username   TEXT NOT NULL UNIQUE,
        email      TEXT NOT NULL UNIQUE,
        password   TEXT NOT NULL,
        display_name TEXT,
        role       TEXT NOT NULL DEFAULT 'viewer',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Seed the first admin only when the users table is empty. The password
    // comes from ADMIN_PASSWORD; if that is unset we generate a random one and
    // print it once, so there is never a well-known default credential.
    const { rows } = await client.query('SELECT COUNT(*) FROM coexistence.forgecrm_users');
    if (parseInt(rows[0].count, 10) === 0) {
      const adminEmail = process.env.ADMIN_EMAIL || 'admin@forgemind.space';
      const generated = !process.env.ADMIN_PASSWORD;
      const adminPassword = process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url');
      const hash = await bcrypt.hash(adminPassword, 10);
      await client.query(
        `INSERT INTO coexistence.forgecrm_users (username, email, password, display_name, role)
         VALUES ('admin', $1, $2, 'Admin', 'admin')`,
        [adminEmail, hash]
      );
      if (generated) {
        console.log(`[auth] Created admin '${adminEmail}' with a GENERATED password: ${adminPassword}`);
        console.log("[auth] Log in and change it now, or set ADMIN_PASSWORD before first boot.");
      } else {
        console.log(`[auth] Created admin '${adminEmail}' from ADMIN_PASSWORD.`);
      }
    }
  } finally {
    client.release();
  }
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, displayName: user.display_name, role: user.role },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
}

function authMiddleware(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // Legacy tokens (issued by the single-user build) carry no role. Force a
    // clean re-login so every session has a role for permission checks.
    if (!payload.role) {
      res.clearCookie(COOKIE_NAME);
      return res.status(401).json({ error: 'Session expired, please sign in again' });
    }
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// POST /api/auth/login
router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT * FROM coexistence.forgecrm_users WHERE email = $1',
      [email.trim().toLowerCase()]
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (user.is_active === false) {
      return res.status(403).json({ error: 'Account is disabled. Contact an administrator.' });
    }
    const token = signToken(user);
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000,
    });
    // Best-effort: stamp last_login_at; don't fail login if this errors.
    pool.query(`UPDATE coexistence.forgecrm_users SET last_login_at = NOW() WHERE id = $1`, [user.id]).catch(() => {});
    const session = await loadUserSession(user.id);
    res.json({ user: session });
  } catch (err) {
    console.error('[auth] login error:', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/me
router.get('/auth/me', authMiddleware, async (req, res) => {
  try {
    const session = await loadUserSession(req.user.id);
    if (!session) {
      res.clearCookie(COOKIE_NAME);
      return res.status(401).json({ error: 'User not found' });
    }
    if (session.isActive === false) {
      res.clearCookie(COOKIE_NAME);
      return res.status(403).json({ error: 'Account disabled' });
    }
    res.json({ user: session });
  } catch (err) {
    console.error('[auth] me error:', err.message);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// POST /api/auth/logout
router.post('/auth/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

module.exports = { router, authMiddleware, ensureTables, COOKIE_NAME };
