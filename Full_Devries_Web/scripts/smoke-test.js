const assert = require('assert');

const baseUrl = 'http://127.0.0.1:3000';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/`, { redirect: 'manual' });
      if (res.status >= 200 && res.status < 500) return;
    } catch (_) {}
    await sleep(300);
  }
  throw new Error('Server did not start in time');
}

async function req(pathname, { method = 'GET', body = null, headers = {}, cookie = '' } = {}) {
  const opts = { method, headers: { ...headers } };
  if (cookie) opts.headers.Cookie = cookie;
  if (body !== null && body !== undefined) opts.body = body;
  const res = await fetch(`${baseUrl}${pathname}`, opts);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) {}
  return { res, text, json };
}

function extractCookie(setCookieHeader) {
  if (!setCookieHeader) return '';
  return setCookieHeader.split(';')[0];
}

async function main() {
  const password = 'SmokePass123!';
  process.env.DEFAULT_ADMIN_PASSWORD = password;
  process.env.NODE_ENV = 'test';
  process.env.ENABLE_DB_BACKUPS = 'false';
  process.env.PORT = '3000';
  if (process.env.TEST_DATABASE_URL) {
    console.log('Using TEST_DATABASE_URL for smoke test.');
  } else {
    console.warn('TEST_DATABASE_URL is not set; smoke test will use DATABASE_URL.');
  }

  const { startServer } = require('../server');
  const server = startServer(3000);

  try {
    await waitForServer();

    const unauth = await req('/api/search?q=');
    assert.strictEqual(unauth.res.status, 401, 'unauthenticated api should be 401');

    const login = await req('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    assert.strictEqual(login.res.status, 200, 'login should return 200');
    assert.strictEqual(login.json?.success, true, 'login should succeed');

    const cookie = extractCookie(login.res.headers.get('set-cookie'));
    assert.ok(cookie, 'login should set session cookie');

    const create = await req('/api/save-client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fName: 'Smoke', lName: 'Test', phone: '5551234', status: 'Lead' }),
      cookie
    });
    assert.strictEqual(create.res.status, 200, 'create client should return 200');

    const list = await req('/api/search?q=Smoke', { cookie });
    assert.strictEqual(list.res.status, 200, 'search should return 200');
    assert.ok(Array.isArray(list.json), 'search response should be array');
    assert.ok(list.json.length > 0, 'search should find created client');
    const clientId = list.json[0].id;
    assert.ok(clientId, 'client id should exist');

    const payment = await req(`/api/clients/${clientId}/payment`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payment: 100 }),
      cookie
    });
    assert.strictEqual(payment.res.status, 200, 'payment should return 200');

    const noteAdd = await req(`/api/notes/add/${clientId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'smoke note' }),
      cookie
    });
    assert.strictEqual(noteAdd.res.status, 200, 'add note should return 200');

    const noteList = await req(`/api/notes/list/${clientId}`, { cookie });
    assert.strictEqual(noteList.res.status, 200, 'list notes should return 200');
    assert.ok(Array.isArray(noteList.json?.notes), 'notes list should be array');

    const form = new FormData();
    form.append('files', new Blob(['smoke upload'], { type: 'application/pdf' }), 'smoke.pdf');

    const uploadRes = await fetch(`${baseUrl}/api/pdf/upload/${clientId}`, {
      method: 'POST',
      body: form,
      headers: { Cookie: cookie }
    });
    const uploadJson = await uploadRes.json();
    assert.strictEqual(uploadRes.status, 200, 'upload should return 200');
    assert.strictEqual(uploadJson.success, true, 'upload should succeed');

    const pdfList = await req(`/api/pdf/list/${clientId}`, { cookie });
    assert.strictEqual(pdfList.res.status, 200, 'list pdf should return 200');
    assert.ok(Array.isArray(pdfList.json?.files) && pdfList.json.files.length > 0, 'pdf list should have file');

    const uploadedName = pdfList.json.files[0].name;
    const delPdf = await req(`/api/pdf/delete/${clientId}/${encodeURIComponent(uploadedName)}`, {
      method: 'DELETE',
      cookie
    });
    assert.strictEqual(delPdf.res.status, 200, 'delete pdf should return 200');

    const delClient = await req('/api/delete-client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: clientId }),
      cookie
    });
    assert.strictEqual(delClient.res.status, 200, 'delete client should return 200');

    console.log('Smoke test passed.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
