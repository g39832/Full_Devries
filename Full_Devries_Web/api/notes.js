const express = require('express');
const db = require('./db');

const router = express.Router();

// ======================================================
// LIST NOTES
// ======================================================
router.get('/list/:clientId', (req, res) => {
  const clientId = parseInt(req.params.clientId);
  if (isNaN(clientId)) return res.status(400).json({ error: 'Invalid client ID' });

  try {
    const notes = db.prepare(
      'SELECT id, content, created_at FROM notes WHERE client_id = ? ORDER BY created_at ASC'
    ).all(clientId);
    res.json({ notes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list notes' });
  }
});

// ======================================================
// ADD NOTE (matches frontend)
// ======================================================
router.post('/add/:clientId', (req, res) => {
  const clientId = parseInt(req.params.clientId);
  const { note } = req.body; // <-- changed to match frontend

  if (isNaN(clientId)) return res.status(400).json({ error: 'Invalid client ID' });
  if (!note || !note.trim()) return res.status(400).json({ error: 'Note content is required' });

  try {
    const result = db.prepare(
      'INSERT INTO notes (client_id, content) VALUES (?, ?)'
    ).run(clientId, note.trim());

    const newNote = db.prepare(
      'SELECT id, content, created_at FROM notes WHERE id = ?'
    ).get(result.lastInsertRowid);

    res.json({ note: newNote });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add note' });
  }
});

// ======================================================
// DELETE NOTE
// ======================================================
router.delete('/delete/:clientId/:noteId', (req, res) => {
  const clientId = parseInt(req.params.clientId);
  const noteId = parseInt(req.params.noteId);

  if (isNaN(clientId) || isNaN(noteId)) return res.status(400).json({ error: 'Invalid parameters' });

  try {
    db.prepare('DELETE FROM notes WHERE id = ? AND client_id = ?').run(noteId, clientId);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

// ======================================================
// UPDATE NOTE
// ======================================================
router.put('/update/:clientId/:noteId', (req, res) => {
  const clientId = parseInt(req.params.clientId);
  const noteId = parseInt(req.params.noteId);
  const { note } = req.body; // <-- changed to match frontend

  if (isNaN(clientId) || isNaN(noteId)) return res.status(400).json({ error: 'Invalid parameters' });
  if (!note || !note.trim()) return res.status(400).json({ error: 'Note content is required' });

  try {
    db.prepare(
      'UPDATE notes SET content = ? WHERE id = ? AND client_id = ?'
    ).run(note.trim(), noteId, clientId);

    const updatedNote = db.prepare(
      'SELECT id, content, created_at FROM notes WHERE id = ?'
    ).get(noteId);

    res.json({ note: updatedNote });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update note' });
  }
});

module.exports = router;