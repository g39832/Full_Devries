const fs = require('fs');
const path = require('path');

const uploadsRoot = path.resolve(__dirname, '..', 'uploads');
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'crm-files';

let remoteBucketReady = false;
let remoteBucketPromise = null;

function isRemoteStorageEnabled() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function isValidUploadKey(key) {
  return typeof key === 'string' && /^[a-zA-Z0-9_-]+$/.test(key);
}

function safeLocalUploadDir(key) {
  if (!isValidUploadKey(key)) return null;
  const resolved = path.resolve(uploadsRoot, key);
  if (!resolved.startsWith(uploadsRoot + path.sep)) return null;
  return resolved;
}

function safeLocalFilePath(key, fileName) {
  const dir = safeLocalUploadDir(key);
  if (!dir || !fileName) return null;
  const baseName = path.basename(fileName);
  if (baseName !== fileName) return null;
  const resolved = path.resolve(dir, baseName);
  if (!resolved.startsWith(dir + path.sep)) return null;
  return resolved;
}

function encodeStoragePath(storagePath) {
  return storagePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function storageHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra
  };
}

async function ensureRemoteBucket() {
  if (!isRemoteStorageEnabled()) return;
  if (remoteBucketReady) return;
  if (!remoteBucketPromise) {
    remoteBucketPromise = (async () => {
      const response = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
        method: 'POST',
        headers: storageHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          name: SUPABASE_STORAGE_BUCKET,
          public: false
        })
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        if (response.status !== 409 && !/already exists/i.test(text)) {
          throw new Error(`Failed to ensure storage bucket: ${response.status} ${text}`);
        }
      }

      remoteBucketReady = true;
    })().finally(() => {
      remoteBucketPromise = null;
    });
  }

  await remoteBucketPromise;
}

async function remoteUploadFile(file, objectPath) {
  await ensureRemoteBucket();

  const body = file.buffer || fs.readFileSync(file.path);
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${SUPABASE_STORAGE_BUCKET}/${encodeStoragePath(objectPath)}`,
    {
      method: 'POST',
      headers: storageHeaders({
        'content-type': file.mimetype || 'application/octet-stream',
        'x-upsert': 'true'
      }),
      body
    }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Remote upload failed: ${response.status} ${text}`);
  }

  return objectPath;
}

async function remoteListFiles(prefix) {
  await ensureRemoteBucket();

  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/list/${SUPABASE_STORAGE_BUCKET}`,
    {
      method: 'POST',
      headers: storageHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        prefix,
        limit: 1000,
        offset: 0,
        sortBy: { column: 'name', order: 'asc' }
      })
    }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Remote list failed: ${response.status} ${text}`);
  }

  const rows = await response.json();
  const files = Array.isArray(rows) ? rows.filter((row) => row && row.name) : [];

  return Promise.all(
    files.map(async (row) => {
      const objectPath = row.name;
      const signedResponse = await fetch(
        `${SUPABASE_URL}/storage/v1/object/sign/${SUPABASE_STORAGE_BUCKET}`,
        {
          method: 'POST',
          headers: storageHeaders({ 'content-type': 'application/json' }),
          body: JSON.stringify({
            expiresIn: 60 * 60,
            paths: [objectPath]
          })
        }
      );

      if (!signedResponse.ok) {
        const text = await signedResponse.text().catch(() => '');
        throw new Error(`Remote signed URL failed: ${signedResponse.status} ${text}`);
      }

      const signedJson = await signedResponse.json();
      const signedRow = Array.isArray(signedJson) ? signedJson[0] : signedJson;
      const signedUrl = signedRow?.signedURL || signedRow?.signedUrl || signedRow?.signed_url || '';

      return {
        name: path.basename(objectPath),
        path: objectPath,
        url: signedUrl ? `${SUPABASE_URL}${signedUrl}` : '',
        ext: path.extname(objectPath).toLowerCase()
      };
    })
  );
}

async function remoteDeleteFile(prefix, fileName) {
  await ensureRemoteBucket();

  const files = await remoteListFiles(prefix);
  const match = files.find((file) => file.name === path.basename(fileName));
  if (!match) return false;

  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${SUPABASE_STORAGE_BUCKET}`,
    {
      method: 'DELETE',
      headers: storageHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        prefixes: [match.path]
      })
    }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Remote delete failed: ${response.status} ${text}`);
  }

  return true;
}

function localListFiles(key) {
  const dir = safeLocalUploadDir(key);
  if (!dir) return [];
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir).map((fileName) => ({
    name: fileName,
    path: `${key}/${fileName}`,
    url: `/uploads/${key}/${encodeURIComponent(fileName)}`,
    ext: path.extname(fileName).toLowerCase()
  }));
}

function localSaveFile(file, key) {
  const dir = safeLocalUploadDir(key);
  if (!dir) throw new Error('Invalid upload path');

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const cleanName = path.basename(file.originalname || 'file');
  const fileName = `${Date.now()}-${cleanName}`;
  const destination = path.join(dir, fileName);
  fs.writeFileSync(destination, file.buffer || fs.readFileSync(file.path));

  return {
    name: fileName,
    path: `${key}/${fileName}`,
    url: `/uploads/${key}/${encodeURIComponent(fileName)}`,
    ext: path.extname(fileName).toLowerCase()
  };
}

function localDeleteFile(key, fileName) {
  const filePath = safeLocalFilePath(key, fileName);
  if (!filePath || !fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

module.exports = {
  isRemoteStorageEnabled,
  ensureRemoteBucket,
  remoteUploadFile,
  remoteListFiles,
  remoteDeleteFile,
  localListFiles,
  localSaveFile,
  localDeleteFile,
  safeLocalUploadDir,
  safeLocalFilePath
};
