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
    const clientId = req.params.clientId;
    const groupKey = req.params.groupKey;

    let dir;

    if (clientId) {
      dir = path.join(__dirname, '..', 'uploads', clientId);
    } else if (groupKey) {
      dir = path.join(__dirname, '..', 'uploads', groupKey);
    } else {
      return cb(new Error("No clientId or groupKey provided"));
    }

    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage });

// ======================================================
// UPLOAD FILE BY CLIENT ID (existing)
// ======================================================
router.post('/upload/:clientId', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded.' });
  }

  res.json({
    success: true,
    fileName: req.file.filename,
    url: `/uploads/${req.params.clientId}/${req.file.filename}`
  });
});

// ======================================================
// UPLOAD FILE BY GROUP-YEAR (finance page)
// ======================================================
router.post('/upload/:groupKey', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded.' });
  }

  res.json({
    success: true,
    fileName: req.file.filename,
    url: `/uploads/${req.params.groupKey}/${req.file.filename}`
  });
});

// ======================================================
// LIST FILES BY CLIENT ID (existing)
// ======================================================
router.get('/list/:clientId', (req, res) => {
  const clientId = req.params.clientId;
  const dir = path.join(__dirname, '..', 'uploads', clientId);

  if (!fs.existsSync(dir)) return res.json({ success: true, files: [] });

  const files = fs.readdirSync(dir).map(f => ({
    name: f,
    url: `/uploads/${clientId}/${f}`,
    ext: path.extname(f).toLowerCase()
  }));

  res.json({ success: true, files });
});

// ======================================================
// LIST FILES BY GROUP-YEAR (finance page)
// ======================================================
router.get('/list/:groupKey', (req, res) => {
  const groupKey = req.params.groupKey;
  const dir = path.join(__dirname, '..', 'uploads', groupKey);

  if (!fs.existsSync(dir)) return res.json({ files: [] });

  const files = fs.readdirSync(dir)
    .filter(f => f.toLowerCase().endsWith('.pdf'))
    .map(f => ({
      name: f,
      url: `/uploads/${groupKey}/${encodeURIComponent(f)}`
    }));

  res.json({ files });
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
