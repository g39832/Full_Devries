const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'client-files';
const STORAGE_BACKEND = (process.env.STORAGE_BACKEND || 'auto').toLowerCase();

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

let remoteBucketReady = false;
let remoteBucketPromise = null;

function isRemoteStorageEnabled() {
  if (STORAGE_BACKEND === 'local') return false;
  if (STORAGE_BACKEND === 'supabase') return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
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
      const { error } = await supabase.storage.createBucket(SUPABASE_STORAGE_BUCKET, {
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
  console.log('remoteUploadFile called');
  console.log('Supabase bucket:', SUPABASE_STORAGE_BUCKET);
  await ensureRemoteBucket();

  const body = file.buffer;
  if (!body) {
    throw new Error('Missing upload buffer for remote upload');
  }

  const { error } = await supabase.storage
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
  await ensureRemoteBucket();

  const { data: items, error } = await supabase.storage
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
      const { data: signedData, error: signedError } = await supabase.storage
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
  await ensureRemoteBucket();

  const { data: items, error } = await supabase.storage
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
  const { error: deleteError } = await supabase.storage
    .from(SUPABASE_STORAGE_BUCKET)
    .remove([objectPath]);

  if (deleteError) {
    throw new Error(`Remote delete failed: ${deleteError.message}`);
  }

  return true;
}

module.exports = {
  isRemoteStorageEnabled,
  ensureRemoteBucket,
  remoteUploadFile,
  remoteListFiles,
  remoteDeleteFile
};
