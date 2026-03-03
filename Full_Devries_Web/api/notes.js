const express = require('express');
const db = require('./db');
const { asyncHandler, assertObject, parseIntField, parseStringField } = require('./request-utils');

const router = express.Router();

// ======================================================
// LIST NOTES
// ======================================================
router.get('/list/:clientId', asyncHandler(async (req, res) => {
  const clientId = parseIntField(req.params.clientId, 'clientId', { min: 1 });
  const notes = db.prepare(
    'SELECT id, content, created_at FROM notes WHERE client_id = ? ORDER BY created_at ASC'
  ).all(clientId);
  res.json({ notes });
}));

// ======================================================
// ADD NOTE (matches frontend)
// ======================================================
router.post('/add/:clientId', asyncHandler(async (req, res) => {
  assertObject(req.body);
  const clientId = parseIntField(req.params.clientId, 'clientId', { min: 1 });
  const note = parseStringField(req.body.note, 'note', { minLength: 1, maxLength: 10000 });

  const result = db.prepare(
    'INSERT INTO notes (client_id, content) VALUES (?, ?)'
  ).run(clientId, note);

  const newNote = db.prepare(
    'SELECT id, content, created_at FROM notes WHERE id = ?'
  ).get(result.lastInsertRowid);

  res.json({ note: newNote });
}));

// ======================================================
// DELETE NOTE
// ======================================================
router.delete('/delete/:clientId/:noteId', asyncHandler(async (req, res) => {
  const clientId = parseIntField(req.params.clientId, 'clientId', { min: 1 });
  const noteId = parseIntField(req.params.noteId, 'noteId', { min: 1 });
  db.prepare('DELETE FROM notes WHERE id = ? AND client_id = ?').run(noteId, clientId);
  res.json({ success: true });
}));

// ======================================================
// UPDATE NOTE
// ======================================================
router.put('/update/:clientId/:noteId', asyncHandler(async (req, res) => {
  assertObject(req.body);
  const clientId = parseIntField(req.params.clientId, 'clientId', { min: 1 });
  const noteId = parseIntField(req.params.noteId, 'noteId', { min: 1 });
  const note = parseStringField(req.body.note, 'note', { minLength: 1, maxLength: 10000 });

  db.prepare(
    'UPDATE notes SET content = ? WHERE id = ? AND client_id = ?'
  ).run(note, noteId, clientId);

  const updatedNote = db.prepare(
    'SELECT id, content, created_at FROM notes WHERE id = ?'
  ).get(noteId);

  res.json({ note: updatedNote });
}));

module.exports = router;
