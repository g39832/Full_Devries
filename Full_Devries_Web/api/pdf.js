const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { asyncHandler, parseStringField } = require('./request-utils');
const uploadsRoot = path.resolve(__dirname, '..', 'uploads');

function isValidUploadKey(key) {
  return typeof key === 'string' && /^[a-zA-Z0-9_-]+$/.test(key);
}

function safeUploadDir(key) {
  if (!isValidUploadKey(key)) return null;
  const resolved = path.resolve(uploadsRoot, key);
  if (!resolved.startsWith(uploadsRoot + path.sep)) return null;
  return resolved;
}

function safeFilePath(key, fileName) {
  const dir = safeUploadDir(key);
  if (!dir || !fileName) return null;
  const baseName = path.basename(fileName);
  if (baseName !== fileName) return null;
  const resolved = path.resolve(dir, baseName);
  if (!resolved.startsWith(dir + path.sep)) return null;
  return resolved;
}

// ======================================================
// STORAGE CONFIG
// ======================================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const key = req.params.key;
    if (!isValidUploadKey(key)) return cb(new Error('Invalid upload key'));

    const dir = safeUploadDir(key);
    if (!dir) return cb(new Error('Invalid upload path'));

    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const cleanName = path.basename(file.originalname || 'file');
    cb(null, Date.now() + '-' + cleanName);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 20
  }
});

// ======================================================
// UPLOAD FILE(S) BY KEY (clientId or groupKey)
// ======================================================
router.post('/upload/:key', upload.any(), (req, res) => {
  const files = req.files || [];
  const key = req.params.key;
  if (!isValidUploadKey(key)) {
    return res.status(400).json({ success: false, error: 'Invalid upload key.' });
  }
  if (!files.length) {
    return res.status(400).json({ success: false, error: 'No files uploaded.' });
  }

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
router.get('/list/:key', asyncHandler(async (req, res) => {
  const key = parseStringField(req.params.key, 'key', { minLength: 1, maxLength: 128 });
  const dir = safeUploadDir(key);
  if (!dir) {
    return res.status(400).json({ success: false, error: 'Invalid list key.' });
  }

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
}));

// ======================================================
// DELETE FILE BY CLIENT ID (existing)
// ======================================================
router.delete('/delete/:clientId/:fileName', asyncHandler(async (req, res) => {
  const clientId = parseStringField(req.params.clientId, 'clientId', { minLength: 1, maxLength: 128 });
  const fileName = parseStringField(req.params.fileName, 'fileName', { minLength: 1, maxLength: 512, trim: false });

  if (!clientId || !fileName) {
    return res.status(400).json({ success: false, error: 'Missing clientId or fileName' });
  }

  const filePath = safeFilePath(clientId, fileName);
  if (!filePath) {
    return res.status(400).json({ success: false, error: 'Invalid path input' });
  }

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
}));

// ======================================================
// DELETE FILE BY GROUP-YEAR (FINANCE FIX)
// ======================================================
router.delete('/delete/:groupKey', asyncHandler(async (req, res) => {
  const groupKey = parseStringField(req.params.groupKey, 'groupKey', { minLength: 1, maxLength: 128 });
  const fileName = parseStringField(req.query.file, 'file', { minLength: 1, maxLength: 512, trim: false });

  if (!groupKey || !fileName) {
    return res.status(400).json({ error: 'Missing groupKey or file name' });
  }

  const decodedFile = decodeURIComponent(fileName);
  const filePath = safeFilePath(groupKey, decodedFile);
  if (!filePath) {
    return res.status(400).json({ error: 'Invalid path input' });
  }

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
}));

module.exports = router;
