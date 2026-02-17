const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ===== STORAGE CONFIG =====
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const clientId = req.params.clientId;

    if (!clientId) {
      return cb(new Error("No clientId provided"));
    }

    const dir = path.join(__dirname, '..', 'uploads', clientId);

    // Create folder if it doesn't exist
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    cb(null, dir);
  },

  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage });

// ===== UPLOAD FILE =====
router.post('/upload/:clientId', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: 'No file uploaded.'
    });
  }

  res.json({
    success: true,
    fileName: req.file.filename,
    url: `/uploads/${req.params.clientId}/${req.file.filename}`
  });
});

// ===== LIST FILES FOR CLIENT =====
router.get('/list/:clientId', (req, res) => {
  const clientId = req.params.clientId;
  const dir = path.join(__dirname, '..', 'uploads', clientId);

  if (!fs.existsSync(dir)) {
    return res.json({ success: true, files: [] });
  }

  const files = fs.readdirSync(dir).map(f => ({
    name: f,
    url: `/uploads/${clientId}/${f}`,
    ext: path.extname(f).toLowerCase()
  }));

  res.json({ success: true, files });
});

module.exports = router;
