const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {
  asyncHandler,
  parseStringField
} = require('./request-utils');
const {
  isRemoteStorageEnabled,
  ensureRemoteBucket,
  remoteUploadFile,
  remoteListFiles,
  remoteDeleteFile,
  localListFiles,
  localDeleteFile,
  safeLocalUploadDir
} = require('../services/storage');

// ======================================================
// STORAGE CONFIG
// ======================================================
const upload = multer(
  isRemoteStorageEnabled()
    ? {
        storage: multer.memoryStorage(),
        limits: {
          fileSize: 25 * 1024 * 1024,
          files: 20
        }
      }
    : {
        storage: multer.diskStorage({
          destination: (req, file, cb) => {
            const key = req.params.key;
            const dir = safeLocalUploadDir(key);
            if (!dir) return cb(new Error('Invalid upload path'));

            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            cb(null, dir);
          },
          filename: (req, file, cb) => {
            const cleanName = path.basename(file.originalname || 'file');
            cb(null, `${Date.now()}-${cleanName}`);
          }
        }),
        limits: {
          fileSize: 25 * 1024 * 1024,
          files: 20
        }
      }
);

// ======================================================
// UPLOAD FILE(S) BY KEY (clientId or groupKey)
// ======================================================
router.post('/upload/:key', upload.any(), asyncHandler(async (req, res) => {
  const files = req.files || [];
  const key = req.params.key;
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
    return res.status(400).json({ success: false, error: 'Invalid upload key.' });
  }
  if (!files.length) {
    return res.status(400).json({ success: false, error: 'No files uploaded.' });
  }

  if (isRemoteStorageEnabled()) {
    await ensureRemoteBucket();
  }

  const saved = [];
  for (const file of files) {
    if (isRemoteStorageEnabled()) {
      const cleanName = path.basename(file.originalname || 'file');
      const objectPath = `${key}/${Date.now()}-${cleanName}`;
      await remoteUploadFile(file, objectPath);
      saved.push({
        name: path.basename(objectPath),
        path: objectPath,
        url: '',
        ext: path.extname(objectPath).toLowerCase()
      });
    } else {
      const fileName = path.basename(file.filename || file.originalname || 'file');
      saved.push({
        name: fileName,
        path: `${key}/${fileName}`,
        url: `/uploads/${key}/${encodeURIComponent(fileName)}`
      });
    }
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

  const isClientId = /^\d+$/.test(key);
  const files = isRemoteStorageEnabled()
    ? (await remoteListFiles(key)).filter((file) => (isClientId ? true : file.ext === '.pdf'))
    : localListFiles(key).filter((file) => (isClientId ? true : file.ext === '.pdf'));

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
    if (isRemoteStorageEnabled()) {
      const deleted = await remoteDeleteFile(clientId, fileName);
      if (!deleted) {
        return res.status(404).json({ success: false, error: 'File not found' });
      }
    } else {
      const deleted = localDeleteFile(clientId, fileName);
      if (!deleted) {
        return res.status(404).json({ success: false, error: 'File not found' });
      }
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
    if (isRemoteStorageEnabled()) {
      const deleted = await remoteDeleteFile(groupKey, decodedFile);
      if (!deleted) return res.status(404).json({ error: 'File not found' });
    } else {
      const deleted = localDeleteFile(groupKey, decodedFile);
      if (!deleted) return res.status(404).json({ error: 'File not found' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Finance delete error:', err);
    res.status(500).json({ error: 'Delete failed' });
  }
}));

module.exports = router;
