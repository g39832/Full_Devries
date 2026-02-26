const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ======================================================
// STORAGE CONFIG
// ======================================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const key = req.params.clientId || req.params.groupKey || req.params.key;
    if (!key) return cb(new Error("No upload key provided"));

    const dir = path.join(__dirname, '..', 'uploads', key);

    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage });

// ======================================================
// UPLOAD FILE(S) BY KEY (clientId or groupKey)
// ======================================================
router.post('/upload/:key', upload.any(), (req, res) => {
  const files = req.files || [];
  if (!files.length) {
    return res.status(400).json({ success: false, error: 'No files uploaded.' });
  }

  const key = req.params.key;
  res.json({
    success: true,
    files: files.map(f => ({
      fileName: f.filename,
      url: `/uploads/${key}/${f.filename}`
    }))
  });
});

// ======================================================
// LIST FILES BY KEY (clientId or groupKey)
// ======================================================
router.get('/list/:key', (req, res) => {
  const key = req.params.key;
  const dir = path.join(__dirname, '..', 'uploads', key);

  if (!fs.existsSync(dir)) return res.json({ success: true, files: [] });

  const isClientId = /^\d+$/.test(key);
  const files = fs.readdirSync(dir)
    .filter(f => (isClientId ? true : f.toLowerCase().endsWith('.pdf')))
    .map(f => ({
      name: f,
      url: `/uploads/${key}/${encodeURIComponent(f)}`,
      ext: path.extname(f).toLowerCase()
    }));

  res.json({ success: true, files });
});

// ======================================================
// DELETE FILE BY CLIENT ID (existing)
// ======================================================
router.delete('/delete/:clientId/:fileName', (req, res) => {
  const clientId = req.params.clientId;
  const fileName = req.params.fileName;

  if (!clientId || !fileName) {
    return res.status(400).json({ success: false, error: 'Missing clientId or fileName' });
  }

  const filePath = path.join(__dirname, '..', 'uploads', clientId, fileName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, error: 'File not found' });
  }

  try {
    fs.unlinkSync(filePath);
    res.json({ success: true, message: 'File deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to delete file' });
  }
});

// ======================================================
// DELETE FILE BY GROUP-YEAR (FINANCE FIX)
// ======================================================
router.delete('/delete/:groupKey', (req, res) => {
  const groupKey = req.params.groupKey;
  const fileName = req.query.file;

  if (!groupKey || !fileName) {
    return res.status(400).json({ error: 'Missing groupKey or file name' });
  }

  const decodedFile = decodeURIComponent(fileName);
  const filePath = path.join(__dirname, '..', 'uploads', groupKey, decodedFile);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  try {
    fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch (err) {
    console.error('Finance delete error:', err);
    res.status(500).json({ error: 'Delete failed' });
  }
});

module.exports = router;
