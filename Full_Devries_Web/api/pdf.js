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
    // Determine folder: either by clientId or groupKey
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

    // Create folder if it doesn't exist
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

module.exports = router;
