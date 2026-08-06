const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'client-files';
const STORAGE_BACKEND = (process.env.STORAGE_BACKEND || 'auto').toLowerCase();

// Local filesystem fallback — files land in <project>/uploads/<key>/...
const uploadsRoot = path.resolve(__dirname, '..', 'uploads');

let supabase = null;

function hasSupabaseConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function getSupabaseClient() {
  if (!hasSupabaseConfig()) return null;
  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    });
  }
  return supabase;
}

let remoteBucketReady = false;
let remoteBucketPromise = null;

function isRemoteStorageEnabled() {
  if (STORAGE_BACKEND === 'local') return false;
  if (STORAGE_BACKEND === 'supabase') return hasSupabaseConfig();
  return hasSupabaseConfig();
}

/**
 * Storage is always available: remote (Supabase) when configured,
 * otherwise the local filesystem under uploads/.
 */
function isStorageAvailable() {
  return true;
}

function storageHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra
  };
}

// ================================================================
// LOCAL FILESYSTEM FALLBACK
// ================================================================

function ensureUploadsDir() {
  if (!fs.existsSync(uploadsRoot)) {
    fs.mkdirSync(uploadsRoot, { recursive: true });
  }
}

function localObjectPath(relativePath) {
  // Never allow path traversal outside uploads/.
  const resolved = path.resolve(uploadsRoot, relativePath);
  if (resolved !== uploadsRoot && !resolved.startsWith(uploadsRoot + path.sep)) {
    throw new Error('Invalid storage path');
  }
  return resolved;
}

async function localUploadFile(file, objectPath) {
  ensureUploadsDir();
  const dest = localObjectPath(objectPath);
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const body = file.buffer;
  if (!body) {
    throw new Error('Missing upload buffer for local upload');
  }
  await fs.promises.writeFile(dest, body);
  return objectPath;
}

function localListFiles(prefix) {
  ensureUploadsDir();
  const dir = localObjectPath(prefix);
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir).filter((name) => {
    try {
      return fs.statSync(path.join(dir, name)).isFile();
    } catch {
      return false;
    }
  });
  return entries.map((name) => {
    const objectPath = `${prefix}/${name}`;
    return {
      name: path.basename(objectPath),
      path: objectPath,
      url: '/uploads/' + objectPath.split('/').map(encodeURIComponent).join('/'),
      ext: path.extname(objectPath).toLowerCase()
    };
  });
}

function localDeleteFile(prefix, fileName) {
  ensureUploadsDir();
  const target = localObjectPath(path.join(prefix, path.basename(fileName)));
  if (!fs.existsSync(target)) return false;
  fs.unlinkSync(target);
  return true;
}

// ================================================================
// REMOTE (SUPABASE) IMPLEMENTATION
// ================================================================

async function ensureRemoteBucket() {
  if (!isRemoteStorageEnabled()) return;
  if (remoteBucketReady) return;
  if (!remoteBucketPromise) {
    remoteBucketPromise = (async () => {
      const client = getSupabaseClient();
      if (!client) {
        throw new Error('Supabase storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or use STORAGE_BACKEND=local.');
      }

      const { error } = await client.storage.createBucket(SUPABASE_STORAGE_BUCKET, {
        public: false
      });

      if (error && !/already exists/i.test(error.message || '')) {
        throw new Error(`Failed to ensure storage bucket: ${error.message}`);
      }

      remoteBucketReady = true;
    })().finally(() => {
      remoteBucketPromise = null;
    });
  }

  await remoteBucketPromise;
}

async function remoteUploadFile(file, objectPath) {
  if (!isRemoteStorageEnabled()) {
    return localUploadFile(file, objectPath);
  }
  console.log('remoteUploadFile called');
  console.log('Supabase bucket:', SUPABASE_STORAGE_BUCKET);
  await ensureRemoteBucket();
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or use STORAGE_BACKEND=local.');
  }

  const body = file.buffer;
  if (!body) {
    throw new Error('Missing upload buffer for remote upload');
  }

  const { error } = await client.storage
    .from(SUPABASE_STORAGE_BUCKET)
    .upload(objectPath, body, {
      upsert: true,
      contentType: file.mimetype || 'application/octet-stream'
    });

  if (error) {
    console.error('Supabase upload error:', error);
    throw new Error(`Remote upload failed: ${error.message}`);
  }

  return objectPath;
}

async function remoteListFiles(prefix) {
  if (!isRemoteStorageEnabled()) {
    return localListFiles(prefix);
  }
  await ensureRemoteBucket();
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or use STORAGE_BACKEND=local.');
  }

  const { data: items, error } = await client.storage
    .from(SUPABASE_STORAGE_BUCKET)
    .list(prefix, {
      limit: 1000,
      offset: 0,
      sortBy: { column: 'name', order: 'asc' }
    });

  if (error) {
    throw new Error(`Remote list failed: ${error.message}`);
  }

  const files = Array.isArray(items) ? items.filter((row) => row && row.name) : [];

  return Promise.all(
    files.map(async (row) => {
      const objectPath = row.name.startsWith(`${prefix}/`) ? row.name : `${prefix}/${row.name}`;
      const { data: signedData, error: signedError } = await client.storage
        .from(SUPABASE_STORAGE_BUCKET)
        .createSignedUrl(objectPath, 60 * 60);

      if (signedError) {
        throw new Error(`Remote signed URL failed: ${signedError.message}`);
      }

      return {
        name: path.basename(objectPath),
        path: objectPath,
        url: signedData?.signedUrl || '',
        ext: path.extname(objectPath).toLowerCase()
      };
    })
  );
}

async function remoteDeleteFile(prefix, fileName) {
  if (!isRemoteStorageEnabled()) {
    return localDeleteFile(prefix, fileName);
  }
  await ensureRemoteBucket();
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or use STORAGE_BACKEND=local.');
  }

  const { data: items, error } = await client.storage
    .from(SUPABASE_STORAGE_BUCKET)
    .list(prefix, {
      limit: 1000,
      offset: 0,
      sortBy: { column: 'name', order: 'asc' }
    });

  if (error) {
    throw new Error(`Remote delete lookup failed: ${error.message}`);
  }

  const match = Array.isArray(items)
    ? items.find((item) => item.name === path.basename(fileName))
    : null;

  if (!match) return false;

  const objectPath = match.name.startsWith(`${prefix}/`) ? match.name : `${prefix}/${match.name}`;
  const { error: deleteError } = await client.storage
    .from(SUPABASE_STORAGE_BUCKET)
    .remove([objectPath]);

  if (deleteError) {
    throw new Error(`Remote delete failed: ${deleteError.message}`);
  }

  return true;
}

module.exports = {
  isStorageAvailable,
  isRemoteStorageEnabled,
  ensureRemoteBucket,
  remoteUploadFile,
  remoteListFiles,
  remoteDeleteFile
};
