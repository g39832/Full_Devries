const assert = require('assert');
const crypto = require('crypto');
const cookieSignature = require('cookie-signature');

// Load .env early so the safety guard below can see TEST_DATABASE_URL
// (server.js loads dotenv too, but the guard runs before that require).
try {
  require('dotenv').config();
} catch (_) {}

const { isStorageAvailable } = require('../services/storage');

const baseUrl = 'http://127.0.0.1:3000';
const SESSION_SECRET = 'smoke-test-secret';
const COOKIE_NAME = 'devries.sid';

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

// Build a signed, authenticated session directly in the store (Google-only
// login means there is no password endpoint to exercise in the suite).
function createSession(app, user) {
  const sid = crypto.randomBytes(24).toString('base64').replace(/[+/=]/g, 'x');
  return new Promise((resolve, reject) => {
    app.locals.sessionStore.set(sid, {
      cookie: { httpOnly: true, path: '/', sameSite: 'lax', originalMaxAge: 12 * 60 * 60 * 1000 },
      authenticated: true,
      user
    }, (err) => {
      if (err) return reject(err);
      const signed = 's:' + cookieSignature.sign(sid, SESSION_SECRET);
      resolve(`${COOKIE_NAME}=${encodeURIComponent(signed)}`);
    });
  });
}

async function mutateSessionRole(app, cookie, role) {
  // Build a session for a specific role (test-only helper; the session store
  // is exposed via app.locals.sessionStore in server.js). The cookie value is
  // signed: "s:<base64url>.<sig>" — the store keys by the bare session id.
  const decoded = decodeURIComponent(cookie.split('=')[1] || '');
  const sid = decoded.split('.')[0].replace(/^s:/, '');
  return new Promise((resolve, reject) => {
    app.locals.sessionStore.get(sid, (err, session) => {
      if (err) return reject(err);
      session.user = {
        id: 999001,
        email: `normal@${role}.test`,
        name: `Test ${role}`,
        role
      };
      app.locals.sessionStore.set(sid, session, (err2) => (err2 ? reject(err2) : resolve()));
    });
  });
}

async function main() {
  process.env.SESSION_SECRET = SESSION_SECRET;
  process.env.NODE_ENV = 'test';
  process.env.ENABLE_DB_BACKUPS = 'false';
  process.env.PORT = '3000';

  // ============================================================
  // SAFETY GUARD: never run the smoke test against the production
  // database unless the operator explicitly opts in.
  // ============================================================
  if (process.env.TEST_DATABASE_URL) {
    console.log('Using TEST_DATABASE_URL for smoke test.');
  } else if (process.env.SMOKE_ALLOW_PRODUCTION === 'true') {
    console.warn('SMOKE_ALLOW_PRODUCTION=true: running smoke test against DATABASE_URL.');
  } else if (process.env.DATABASE_URL) {
    throw new Error(
      'Refusing to run smoke test against DATABASE_URL (production).\n' +
      'Set TEST_DATABASE_URL to a dedicated test database, or set ' +
      'SMOKE_ALLOW_PRODUCTION=true to explicitly allow it.'
    );
  } else {
    throw new Error('Neither TEST_DATABASE_URL nor DATABASE_URL is set.');
  }

  const { startServer, app } = require('../server');
  const server = startServer(3000);

  try {
    await waitForServer();

    // ================= REGRESSION: unauthenticated API =================
    const unauth = await req('/api/search?q=');
    assert.strictEqual(unauth.res.status, 401, 'unauthenticated api should be 401');

    // ================= REGRESSION: admin session (Google-only login) =================
    const cookie = await createSession(app, {
      id: 999000,
      email: 'admin@test',
      name: 'Test Admin',
      role: 'admin'
    });
    assert.ok(cookie, 'should build an admin session cookie');

    // ================= /api/auth/me =================
    const me = await req('/api/auth/me', { cookie });
    assert.strictEqual(me.res.status, 200, '/api/auth/me should return 200');
    assert.strictEqual(me.json?.user?.role, 'admin', 'admin session should be admin');

    // ================= Client + Jobs (no duplicate clients) =================
    // Unique name so the suite is re-runnable against a persistent test DB.
    const uniqueSuffix = Date.now().toString(36);
    const clientName = `John Smith ${uniqueSuffix}`;
    const create = await req('/api/save-client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fName: 'John', lName: `Smith ${uniqueSuffix}`, phone: '5551234', status: 'Prospect' }),
      cookie
    });
    assert.strictEqual(create.res.status, 200, 'create client should return 200');

    const list = await req(`/api/search?q=John+Smith+${uniqueSuffix}`, { cookie });
    assert.ok(Array.isArray(list.json), 'search response should be array');
    const johns = list.json.filter((c) => c.name === clientName);
    assert.strictEqual(johns.length, 1, 'exactly one matching client should exist');
    const clientId = johns[0].id;
    assert.ok(clientId, 'client id should exist');
    assert.strictEqual(Number(johns[0].job_count), 1, 'new client should start with one default job');

    // Add jobs 1/2/3 to the SAME client
    const jobNames = ['Job 1', 'Job 2', 'Job 3'];
    const jobIds = [];
    for (const name of jobNames) {
      const addJob = await req(`/api/clients/${clientId}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, status: 'Pending Approval', total_due: 5000, job_cost: 3000 }),
        cookie
      });
      assert.strictEqual(addJob.res.status, 200, `add job ${name} should return 200`);
      assert.ok(addJob.json?.job?.id, 'job should have an id');
      jobIds.push(addJob.json.job.id);
    }

    // Confirm no duplicate clients were created by adding jobs
    const listAgain = await req(`/api/search?q=John+Smith+${uniqueSuffix}`, { cookie });
    const johnsAgain = listAgain.json.filter((c) => c.name === clientName);
    assert.strictEqual(johnsAgain.length, 1, 'adding jobs must never duplicate the client');

    const clientJobs = await req(`/api/clients/${clientId}/jobs`, { cookie });
    assert.strictEqual(clientJobs.res.status, 200, 'list jobs should return 200');
    assert.ok(Array.isArray(clientJobs.json.jobs), 'jobs should be an array');
    assert.strictEqual(clientJobs.json.jobs.length, 4, 'client should have 4 jobs (default + 3)');
    assert.ok(clientJobs.json.jobs.every((j) => Number(j.client_id) === Number(clientId)), 'all jobs belong to the client');

    // ================= Approval → Finance (idempotent) =================
    const job1 = jobIds[0];
    // Payments must be blocked before approval
    const earlyPayment = await req(`/api/jobs/${job1}/payment`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payment: 100 }),
      cookie
    });
    assert.strictEqual(earlyPayment.res.status, 400, 'payment on unapproved job should be rejected');

    const approve = await req(`/api/jobs/${job1}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Approved' }),
      cookie
    });
    assert.strictEqual(approve.res.status, 200, 'approve job should return 200');

    // Approve again — must be idempotent (no duplicate records)
    const approveAgain = await req(`/api/jobs/${job1}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Approved' }),
      cookie
    });
    assert.strictEqual(approveAgain.res.status, 200, 're-approve should return 200');

    // ================= Payment + Expense + math =================
    const payment = await req(`/api/jobs/${job1}/payment`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payment: 1000 }),
      cookie
    });
    assert.strictEqual(payment.res.status, 200, 'payment should return 200');
    assert.strictEqual(payment.json.job.finance.paid, 1000, 'paid should be 1000');

    const expense = await req(`/api/jobs/${job1}/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'Labor', amount: 200, notes: 'crew' }),
      cookie
    });
    assert.strictEqual(expense.res.status, 200, 'expense should return 200');

    const jobDetail = await req(`/api/jobs/${job1}`, { cookie });
    const f = jobDetail.json.job.finance;
    // total_due=5000, paid=1000, expenses = 200 (entry) + 3000 (job_cost) = 3200
    assert.strictEqual(f.total_due, 5000, 'total due should be 5000');
    assert.strictEqual(f.paid, 1000, 'paid should be 1000');
    assert.strictEqual(f.balance_due, 4000, 'balance due = 5000 - 1000');
    assert.strictEqual(f.overpayment, 0, 'no overpayment yet');
    assert.strictEqual(f.expenses, 3200, 'expenses = entry 200 + job cost 3000');
    assert.strictEqual(f.profit, -2200, 'profit = paid - expenses = 1000 - 3200');
    const expectedMargin = Math.round(((1000 - 3200) / 1000) * 1000) / 10;
    assert.strictEqual(f.margin_pct, expectedMargin, 'margin % = profit / paid * 100');

    // ================= Overpayment (never a negative balance) =================
    const overpay = await req(`/api/jobs/${job1}/payment`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payment: 6000 }),
      cookie
    });
    assert.strictEqual(overpay.res.status, 200, 'overpayment should return 200');
    assert.strictEqual(overpay.json.job.finance.paid, 7000, 'paid should be 7000');
    assert.strictEqual(overpay.json.job.finance.balance_due, 0, 'balance due must be 0 (never negative)');
    assert.strictEqual(overpay.json.job.finance.overpayment, 2000, 'overpayment/credit should be 2000');

    // ================= Tags =================
    const createTag = await req('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Prospect' }),
      cookie
    });
    assert.strictEqual(createTag.res.status, 200, 'create tag should return 200');
    const tagId = createTag.json.tag.id;

    // Duplicate tag (case-insensitive) must be rejected
    const dupTag = await req('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'prospect' }),
      cookie
    });
    assert.strictEqual(dupTag.res.status, 409, 'duplicate tag (case-insensitive) should be rejected');

    // Attach tag to Job 1 and Job 2
    for (const jid of [jobIds[0], jobIds[1]]) {
      const setTags = await req(`/api/jobs/${jid}/tags`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagIds: [tagId] }),
        cookie
      });
      assert.strictEqual(setTags.res.status, 200, 'set tags should return 200');
    }

    // Filter by tag
    const tagged = await req(`/api/jobs?tag_id=${tagId}`, { cookie });
    assert.strictEqual(tagged.res.status, 200, 'filter jobs by tag should return 200');
    assert.strictEqual(tagged.json.jobs.length, 2, 'two jobs should have the tag');

    // Rename tag — relationships must survive
    const renameTag = await req(`/api/tags/${tagId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed Tag' }),
      cookie
    });
    assert.strictEqual(renameTag.res.status, 200, 'rename tag should return 200');
    const taggedAfterRename = await req(`/api/jobs?tag_id=${tagId}`, { cookie });
    assert.strictEqual(taggedAfterRename.json.jobs.length, 2, 'rename must preserve job relationships');

    // Delete tag — jobs intact, tag filter empty
    const delTag = await req(`/api/tags/${tagId}`, { method: 'DELETE', cookie });
    assert.strictEqual(delTag.res.status, 200, 'delete tag should return 200');
    const afterTagDelete = await req(`/api/jobs?tag_id=${tagId}`, { cookie });
    assert.strictEqual(afterTagDelete.json.jobs.length, 0, 'deleted tag should have no jobs');

    // ================= Job photos (scoped to the job) =================
    const storageEnabled = isStorageAvailable();
    if (!storageEnabled) {
      console.warn('Remote storage not configured; skipping photo upload/list/delete assertions.');
    } else {
      const form = new FormData();
      form.append('files', new Blob(['job one photo'], { type: 'image/png' }), 'job1-photo.png');
      const uploadRes = await fetch(`${baseUrl}/api/pdf/upload/job-${jobIds[0]}`, {
        method: 'POST',
        body: form,
        headers: { Cookie: cookie }
      });
      assert.strictEqual(uploadRes.status, 200, 'job photo upload should return 200');

      const photos1 = await req(`/api/jobs/${jobIds[0]}/photos`, { cookie });
      assert.strictEqual(photos1.res.status, 200, 'list job photos should return 200');
      assert.ok(photos1.json.files.some((f) => f.name.includes('job1-photo.png')), 'photo should be listed for job 1');

      const photos2 = await req(`/api/jobs/${jobIds[1]}/photos`, { cookie });
      assert.ok(!photos2.json.files.some((f) => f.name.includes('job1-photo.png')), 'job 2 must not see job 1 photos');
    }

    // ================= Notifications =================
    const notifs = await req('/api/notifications', { cookie });
    assert.strictEqual(notifs.res.status, 200, 'notifications should return 200');
    const types = (notifs.json.notifications || []).map((n) => n.type);
    assert.ok(types.includes('approved'), 'approval should create an approved notification');
    assert.ok(types.includes('payment'), 'payment should create a payment notification');
    assert.ok(types.includes('overpayment'), 'overpayment should create an overpayment notification');
    // Idempotent approval → exactly one "approved" notification for job 1
    const approvedForJob = (notifs.json.notifications || []).filter(
      (n) => n.type === 'approved' && Number(n.job_id) === Number(job1)
    );
    assert.strictEqual(approvedForJob.length, 1, 're-approval must not duplicate notifications');

    // ================= Admin finance adjustment (audit trail) =================
    const adjListBefore = await req(`/api/admin/finance-adjustments?jobId=${job1}`, { cookie });
    assert.strictEqual(adjListBefore.res.status, 200, 'admin adjustments should return 200');

    const adjPayload = {
      jobId: job1,
      recordType: 'job_cost',
      newValue: 2500,
      reason: 'Smoke test correction'
    };
    const adj = await req('/api/admin/finance-adjustments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(adjPayload),
      cookie
    });
    assert.strictEqual(adj.res.status, 200, 'admin adjustment should return 200');
    assert.strictEqual(adj.json.adjustment.old_value, 3000, 'audit should record original job cost');
    assert.strictEqual(adj.json.adjustment.new_value, 2500, 'audit should record new job cost');
    assert.strictEqual(adj.json.adjustment.reason, 'Smoke test correction', 'audit should record reason');
    assert.ok(adj.json.adjustment.adjusted_by, 'audit should record who adjusted');

    const adjListAfter = await req(`/api/admin/finance-adjustments?jobId=${job1}`, { cookie });
    assert.ok(adjListAfter.json.adjustments.length >= 1, 'adjustment should appear in audit trail');

    // ================= Activity log (who did what) =================
    const activityAdmin = await req('/api/admin/activity', { cookie });
    assert.strictEqual(activityAdmin.res.status, 200, 'admin activity should return 200');
    assert.ok(Array.isArray(activityAdmin.json.activity), 'activity should be an array');
    assert.ok(
      activityAdmin.json.activity.some((a) => a.actor_email === 'admin@test'),
      'activity should record the acting admin'
    );

    // ================= Roles: normal user cannot reach admin functions =================
    await mutateSessionRole(app, cookie, 'user');
    const normalMe = await req('/api/auth/me', { cookie });
    assert.strictEqual(normalMe.json.user.role, 'user', 'session should now be a normal user');

    const blockedAdj = await req('/api/admin/finance-adjustments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: job1, recordType: 'job_cost', newValue: 1, reason: 'should fail' }),
      cookie
    });
    assert.strictEqual(blockedAdj.res.status, 403, 'normal user must get 403 on admin finance adjustment');
    const blockedTags = await req('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'ShouldFail' }),
      cookie
    });
    assert.strictEqual(blockedTags.res.status, 403, 'normal user must get 403 on tag creation');
    const blockedUsers = await req('/api/admin/users', { cookie });
    assert.strictEqual(blockedUsers.res.status, 403, 'normal user must get 403 on user list');
    const blockedActivity = await req('/api/admin/activity', { cookie });
    assert.strictEqual(blockedActivity.res.status, 403, 'normal user must get 403 on activity log');

    // Restore admin for the remaining regression checks
    await mutateSessionRole(app, cookie, 'admin');

    // ================= REGRESSION: notes =================
    const noteAdd = await req(`/api/notes/add/${clientId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'smoke note' }),
      cookie
    });
    assert.strictEqual(noteAdd.res.status, 200, 'add note should return 200');
    const noteList = await req(`/api/notes/list/${clientId}`, { cookie });
    assert.ok(Array.isArray(noteList.json?.notes), 'notes list should be array');

    // Job-scoped notes
    const jobNote = await req(`/api/notes/job/${job1}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'job one note' }),
      cookie
    });
    assert.strictEqual(jobNote.res.status, 200, 'add job note should return 200');
    const jobNoteList = await req(`/api/notes/job/${job1}`, { cookie });
    assert.ok(jobNoteList.json.notes.some((n) => n.content === 'job one note'), 'job note should list');

    // ================= REGRESSION: client-level PDF upload =================
    if (storageEnabled) {
      const form = new FormData();
      form.append('files', new Blob(['smoke upload'], { type: 'application/pdf' }), 'smoke.pdf');
      const uploadRes = await fetch(`${baseUrl}/api/pdf/upload/${clientId}`, {
        method: 'POST',
        body: form,
        headers: { Cookie: cookie }
      });
      const uploadJson = await uploadRes.json();
      assert.strictEqual(uploadRes.status, 200, 'client upload should return 200');
      assert.strictEqual(uploadJson.success, true, 'client upload should succeed');

      const pdfList = await req(`/api/pdf/list/${clientId}`, { cookie });
      assert.ok(Array.isArray(pdfList.json?.files) && pdfList.json.files.length > 0, 'pdf list should have file');

      const uploadedName = pdfList.json.files[0].name;
      const delPdf = await req(`/api/pdf/delete/${clientId}/${encodeURIComponent(uploadedName)}`, {
        method: 'DELETE',
        cookie
      });
      assert.strictEqual(delPdf.res.status, 200, 'delete pdf should return 200');
    }

    // ================= REGRESSION: finance summary/years =================
    const years = await req('/api/finance/years', { cookie });
    assert.strictEqual(years.res.status, 200, 'finance years should return 200');
    const summary = await req(`/api/finance/summary?year=${new Date().getFullYear()}`, { cookie });
    assert.strictEqual(summary.res.status, 200, 'finance summary should return 200');

    // ================= LOGOUT =================
    const logout = await req('/api/auth/logout', { method: 'POST', cookie });
    assert.strictEqual(logout.res.status, 200, 'logout should return 200');
    const afterLogout = await req('/api/search?q=', { cookie });
    assert.strictEqual(afterLogout.res.status, 401, 'after logout, API should be 401');

    console.log('Smoke test passed.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
