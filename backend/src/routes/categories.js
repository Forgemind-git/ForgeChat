const { Router } = require('express');
const pool = require('../db');
const { requirePermission } = require('../middleware/access');

const router = Router();

// Helper to generate IDs
function genId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

/* ------------------------------------------------------------------ */
/*  Categories                                                         */
/* ------------------------------------------------------------------ */

// GET /api/categories
router.get('/categories', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, description, created_at, updated_at FROM coexistence.categories ORDER BY name ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error('[categories] GET /categories error:', err.message);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// POST /api/categories
router.post('/categories', requirePermission('admin-settings:category'), async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    const id = genId('cat');
    const { rows } = await pool.query(
      `INSERT INTO coexistence.categories (id, name, description)
       VALUES ($1, $2, $3)
       RETURNING id, name, description, created_at, updated_at`,
      [id, name.trim(), (description || '').trim()]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[categories] POST /categories error:', err.message);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// PUT /api/categories/:id
router.put('/categories/:id', requirePermission('admin-settings:category'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    const { rows } = await pool.query(
      `UPDATE coexistence.categories
       SET name = $1, description = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING id, name, description, created_at, updated_at`,
      [name.trim(), (description || '').trim(), id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Category not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[categories] PUT /categories/:id error:', err.message);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// DELETE /api/categories/:id
router.delete('/categories/:id', requirePermission('admin-settings:category'), async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await pool.query(
      'DELETE FROM coexistence.categories WHERE id = $1',
      [id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Category not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[categories] DELETE /categories/:id error:', err.message);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

/* ------------------------------------------------------------------ */
/*  Tags                                                               */
/* ------------------------------------------------------------------ */

// GET /api/tags
router.get('/tags', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.name, t.color, t.category_id, t.created_at, t.updated_at,
              c.name as category_name
       FROM coexistence.tags t
       LEFT JOIN coexistence.categories c ON c.id = t.category_id
       ORDER BY t.name ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error('[categories] GET /tags error:', err.message);
    res.status(500).json({ error: 'Failed to fetch tags' });
  }
});

// POST /api/tags
router.post('/tags', requirePermission('admin-settings:tags'), async (req, res) => {
  try {
    const { name, color, categoryId } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (!categoryId) {
      return res.status(400).json({ error: 'Category is required' });
    }
    const id = genId('tag');
    const { rows } = await pool.query(
      `INSERT INTO coexistence.tags (id, name, color, category_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, color, category_id, created_at, updated_at`,
      [id, name.trim(), color || '#dc2626', categoryId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[categories] POST /tags error:', err.message);
    res.status(500).json({ error: 'Failed to create tag' });
  }
});

// PUT /api/tags/:id
router.put('/tags/:id', requirePermission('admin-settings:tags'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, color, categoryId } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    const { rows } = await pool.query(
      `UPDATE coexistence.tags
       SET name = $1, color = $2, category_id = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING id, name, color, category_id, created_at, updated_at`,
      [name.trim(), color || '#dc2626', categoryId, id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Tag not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[categories] PUT /tags/:id error:', err.message);
    res.status(500).json({ error: 'Failed to update tag' });
  }
});

// DELETE /api/tags/:id
router.delete('/tags/:id', requirePermission('admin-settings:tags'), async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await pool.query(
      'DELETE FROM coexistence.tags WHERE id = $1',
      [id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Tag not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[categories] DELETE /tags/:id error:', err.message);
    res.status(500).json({ error: 'Failed to delete tag' });
  }
});

module.exports = { router };
