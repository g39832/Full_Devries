const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const {
  asyncHandler,
  parseStringField
} = require('./request-utils');
const {
  isStorageAvailable,
  ensureRemoteBucket,
  remoteUploadFile,
  remoteListFiles,
  remoteDeleteFile
} = require('../services/storage');

// ======================================================
// STORAGE CONFIG
// ======================================================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 20
  }
});

// ======================================================
// UPLOAD FILE(S) BY KEY (clientId or groupKey)
// ======================================================
router.post('/upload/:key', upload.any(), asyncHandler(async (req, res) => {
  console.log('UPLOAD ROUTE HIT');
  console.log('upload route files count:', (req.files || []).length);
  console.log('SUPABASE_URL defined:', Boolean(process.env.SUPABASE_URL));
  console.log('SUPABASE_SERVICE_ROLE_KEY defined:', Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY));

  const files = req.files || [];
  const key = req.params.key;
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
    return res.status(400).json({ success: false, error: 'Invalid upload key.' });
  }
  if (!files.length) {
    return res.status(400).json({ success: false, error: 'No files uploaded.' });
  }

  if (!isStorageAvailable()) {
    return res.status(500).json({ success: false, error: 'Storage is not available.' });
  }

  await ensureRemoteBucket();

  const saved = [];
  for (const file of files) {
    const cleanName = path.basename(file.originalname || 'file');
    const objectPath = `${key}/${Date.now()}-${cleanName}`;
    console.log('Uploading to Supabase:', objectPath);
    try {
      await remoteUploadFile(file, objectPath);
      console.log('Upload succeeded for:', objectPath);
    } catch (err) {
      console.error('Upload failed for:', objectPath, 'error:', err);
      throw err;
    }
    saved.push({
      name: path.basename(objectPath),
      path: objectPath,
      url: '',
      ext: path.extname(objectPath).toLowerCase()
    });
  }

  res.json({
    success: true,
    files: saved
  });
}));

// ======================================================
// LIST FILES BY KEY (clientId or groupKey)
// ======================================================
router.get('/list/:key', asyncHandler(async (req, res) => {
  const key = parseStringField(req.params.key, 'key', { minLength: 1, maxLength: 128 });
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
    return res.status(400).json({ success: false, error: 'Invalid list key.' });
  }

  if (!isStorageAvailable()) {
    return res.status(500).json({ success: false, error: 'Storage is not available.' });
  }

  const isClientId = /^\d+$/.test(key);
  const files = (await remoteListFiles(key)).filter((file) => (isClientId ? true : file.ext === '.pdf'));

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

  try {
    if (!isStorageAvailable()) {
      return res.status(500).json({ success: false, error: 'Storage is not available.' });
    }

    const deleted = await remoteDeleteFile(clientId, fileName);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }

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
  try {
    if (!isStorageAvailable()) {
      return res.status(500).json({ error: 'Storage is not available.' });
    }

    const deleted = await remoteDeleteFile(groupKey, decodedFile);
    if (!deleted) return res.status(404).json({ error: 'File not found' });

    res.json({ success: true });
  } catch (err) {
    console.error('Finance delete error:', err);
    res.status(500).json({ error: 'Delete failed' });
  }
}));

module.exports = router;
