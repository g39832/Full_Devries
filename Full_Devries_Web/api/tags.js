const express = require('express');
const router = express.Router();
const db = require('./db');
const { asyncHandler, assertObject, parseIntField, parseStringField, AppError } = require('./request-utils');
const { requireRole } = require('./auth');

// ======================================================
// LIST TAGS (any authenticated user) with job usage counts
// ======================================================
router.get('/', asyncHandler(async (req, res) => {
  await db.schemaReady;
  const { rows } = await db.query(`
    SELECT t.id, t.name, t.created_at, COUNT(jt.job_id)::int AS job_count
    FROM tags t
    LEFT JOIN job_tags jt ON jt.tag_id = t.id
    GROUP BY t.id, t.name, t.created_at
    ORDER BY lower(t.name) ASC
  `);
  return res.json({ success: true, tags: rows });
}));

// ======================================================
// CREATE TAG (admin only, case-insensitive unique)
// ======================================================
router.post('/', requireRole('admin'), asyncHandler(async (req, res) => {
  assertObject(req.body);
  const name = parseStringField(req.body.name ?? '', 'name', { minLength: 1, maxLength: 80 });
  const normalized = name.trim();

  await db.schemaReady;
  const existing = await db.query('SELECT id FROM tags WHERE lower(name) = lower($1)', [normalized]);
  if (existing.rows[0]) {
    return res.status(409).json({ error: `Tag "${existing.rows[0] && normalized}" already exists.` });
  }

  let rows;
  try {
    rows = (await db.query('INSERT INTO tags (name) VALUES ($1) RETURNING *', [normalized])).rows;
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(409).json({ error: 'Tag already exists (case-insensitive).' });
    }
    throw err;
  }
  return res.json({ success: true, tag: rows[0] });
}));

// ======================================================
// RENAME TAG (admin only — preserves job relationships)
// ======================================================
router.put('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  assertObject(req.body);
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  const name = parseStringField(req.body.name ?? '', 'name', { minLength: 1, maxLength: 80 });
  const normalized = name.trim();

  await db.schemaReady;
  const existing = await db.query('SELECT id, name FROM tags WHERE lower(name) = lower($1) AND id <> $2', [normalized, id]);
  if (existing.rows[0]) {
    return res.status(409).json({ error: `Another tag named "${normalized}" already exists.` });
  }

  const { rows } = await db.query('UPDATE tags SET name = $1 WHERE id = $2 RETURNING *', [normalized, id]);
  if (!rows[0]) return res.status(404).json({ error: 'Tag not found' });
  return res.json({ success: true, tag: rows[0] });
}));

// ======================================================
// DELETE TAG (admin only — job_tags cascade; jobs are untouched)
// ======================================================
router.delete('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const id = parseIntField(req.params.id, 'id', { min: 1 });
  await db.schemaReady;
  const { rows } = await db.query('DELETE FROM tags WHERE id = $1 RETURNING id, name', [id]);
  if (!rows[0]) return res.status(404).json({ error: 'Tag not found' });
  return res.json({ success: true, tag: rows[0] });
}));

module.exports = router;
