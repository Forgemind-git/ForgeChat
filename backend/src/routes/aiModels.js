// AI Models registry — workspace-wide LLM provider credentials.
//
// One row per (provider, API key) the workspace has connected. Agents reference
// a row by id (coexistence.agents.ai_model_id) instead of carrying their own
// key, so a key is configured once (Admin Settings → Integrations → AI Models)
// and rotating it updates every agent at once. Keys are AES-256-GCM at rest
// (util/crypto.js) and never returned in plaintext except via ?reveal=1 on the
// single-row GET, which is gated to admins.
//
// v1 supports the two providers the agent engine has tool-use adapters for:
// Anthropic and OpenAI. The exact model (e.g. gpt-4o-mini) is chosen per-agent
// in the agent editor — this registry only stores the provider + credential.

const { Router } = require('express');
const pool = require('../db');
const { encrypt, decrypt, maskSecret } = require('../util/crypto');
const { adminOnly } = require('../middleware/access');

const router = Router();

const SUPPORTED = new Set(['anthropic', 'openai']);
const PROVIDER_LABELS = { anthropic: 'Anthropic Claude', openai: 'OpenAI' };

// Listing models is needed by the agent editor, which non-admin operators with
// agent access may open — so list/get(masked) only require authentication.
// Mutations and plaintext reveal require admin (they manage a shared secret).
function authed(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function shape(row, { reveal = false } = {}) {
  if (!row) return null;
  const apiKey = decrypt(row.api_key_encrypted);
  return {
    id: row.id,
    provider: row.provider,
    providerLabel: PROVIDER_LABELS[row.provider] || row.provider,
    label: row.label || null,
    apiKeyMasked: maskSecret(apiKey || ''),
    apiKey: reveal ? (apiKey || '') : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// List — any authenticated user (the agent editor needs this).
router.get('/ai-models', authed, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM coexistence.ai_models ORDER BY created_at DESC`,
    );
    res.json(rows.map(r => shape(r)));
  } catch (err) {
    console.error('[ai-models] list error:', err.message);
    res.status(500).json({ error: 'Failed to list AI models' });
  }
});

// Get one — plaintext key only with ?reveal=1 AND admin role.
router.get('/ai-models/:id', authed, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM coexistence.ai_models WHERE id = $1',
      [req.params.id],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const reveal = req.query.reveal === '1' && req.user?.role === 'admin';
    res.json(shape(rows[0], { reveal }));
  } catch (err) {
    console.error('[ai-models] get error:', err.message);
    res.status(500).json({ error: 'Failed to fetch AI model' });
  }
});

// Create — admin only. Body: { provider, apiKey, label? }
router.post('/ai-models', adminOnly, async (req, res) => {
  try {
    const b = req.body || {};
    const provider = String(b.provider || '').trim().toLowerCase();
    const apiKey = typeof b.apiKey === 'string' ? b.apiKey.trim() : '';
    if (!provider || !apiKey) {
      return res.status(400).json({ error: 'provider and apiKey are required' });
    }
    if (!SUPPORTED.has(provider)) {
      return res.status(400).json({ error: "provider must be 'anthropic' or 'openai'" });
    }
    const { rows } = await pool.query(
      `INSERT INTO coexistence.ai_models (provider, label, api_key_encrypted, available_models)
       VALUES ($1, $2, $3, '[]'::jsonb)
       RETURNING *`,
      [provider, b.label?.trim() || null, encrypt(apiKey)],
    );
    res.status(201).json(shape(rows[0]));
  } catch (err) {
    console.error('[ai-models] create error:', err.message);
    res.status(500).json({ error: 'Failed to add AI model' });
  }
});

// Update — admin only. Rotate the key and/or rename. An empty-string apiKey is
// rejected (a registry row must always hold a usable key); omit apiKey to keep
// the existing one.
router.put('/ai-models/:id', adminOnly, async (req, res) => {
  try {
    const b = req.body || {};
    const sets = ['updated_at = NOW()'];
    const params = [];
    let i = 1;
    const push = (col, val) => { sets.push(`${col} = $${i++}`); params.push(val); };

    if (b.provider !== undefined) {
      const provider = String(b.provider).trim().toLowerCase();
      if (!SUPPORTED.has(provider)) {
        return res.status(400).json({ error: "provider must be 'anthropic' or 'openai'" });
      }
      push('provider', provider);
    }
    if (b.label !== undefined) push('label', b.label?.trim() || null);
    if (b.apiKey !== undefined) {
      const key = String(b.apiKey).trim();
      if (!key) return res.status(400).json({ error: 'apiKey cannot be empty — omit it to keep the current key' });
      push('api_key_encrypted', encrypt(key));
    }

    if (sets.length === 1) return res.status(400).json({ error: 'No updatable fields provided' });

    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE coexistence.ai_models SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      params,
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(shape(rows[0]));
  } catch (err) {
    console.error('[ai-models] update error:', err.message);
    res.status(500).json({ error: 'Failed to update AI model' });
  }
});

// Delete — admin only. Agents referencing this model have ai_model_id set NULL
// by the FK (ON DELETE SET NULL); the agent editor then flags them as needing a
// model and the engine refuses to run them until one is re-selected.
router.delete('/ai-models/:id', adminOnly, async (req, res) => {
  try {
    // Demote any agents pointing at this model to drafts BEFORE deleting, while
    // the FK still matches. The FK's ON DELETE SET NULL only nulls ai_model_id —
    // it can't flip status/is_active, so an active agent would otherwise be left
    // marked active but unrunnable (engine refuses with no provider). Mirrors
    // the migration's fail-safe for env-key agents.
    const { rowCount: demoted } = await pool.query(
      `UPDATE coexistence.agents SET status = 'draft', is_active = FALSE, updated_at = NOW()
        WHERE ai_model_id = $1`,
      [req.params.id],
    );
    const { rowCount } = await pool.query(
      'DELETE FROM coexistence.ai_models WHERE id = $1',
      [req.params.id],
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, detachedAgents: demoted });
  } catch (err) {
    console.error('[ai-models] delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete AI model' });
  }
});

module.exports = { router };
