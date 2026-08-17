// scripts/cleanup-smoke-data.js
// Removes smoke-test data left in the live database by scripts/smoke-test.js.
//
// SAFETY:
//   * Default = DRY RUN (read-only). It prints exactly what it would delete.
//   * Pass --execute to actually delete (runs inside a single transaction).
//   * Only targets unambiguous test records:
//       - clients named "John Smith <suffix>" with phone "5551234"
//       - client tags named "ClientTag <suffix>" (kind = 'client')
//       - test app_users with ids 999000 / 999001 (admin@test / normal@user.test)
//       - records directly linked to the above (jobs, payments, notes, expenses,
//         line items, tags, notifications, adjustments, activity log).
require('dotenv').config();
const { Pool } = require('pg');

const EXECUTE = process.argv.includes('--execute');
const USE_TEST = process.argv.includes('--test');
const url = USE_TEST ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
if (!url) {
  console.error(`No ${USE_TEST ? 'TEST_DATABASE_URL' : 'DATABASE_URL'} set.`);
  process.exit(1);
}

const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

async function scalar(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows[0] || {};
}

async function main() {
  console.log(`Mode: ${EXECUTE ? 'EXECUTE (deleting)' : 'DRY RUN (read-only)'}\n`);

  // ---- Identify test records -------------------------------------------------
  const clients = (await pool.query(
    `SELECT id, name, phone, status FROM clients
     WHERE phone = '5551234' AND name LIKE 'John Smith %'
     ORDER BY id`
  )).rows;

  const clientTags = (await pool.query(
    `SELECT id, name FROM tags WHERE name LIKE 'ClientTag %' ORDER BY id`
  )).rows;

  const testUsers = (await pool.query(
    `SELECT id, email, name, role FROM app_users WHERE id IN (999000, 999001) ORDER BY id`
  )).rows;

  const clientIds = clients.map((c) => c.id);
  const tagIds = clientTags.map((t) => t.id);

  let jobIds = [];
  if (clientIds.length) {
    jobIds = (await pool.query(
      `SELECT id FROM jobs WHERE client_id = ANY($1::bigint[])`,
      [clientIds]
    )).rows.map((j) => j.id);
  }

  // ---- Count linked records --------------------------------------------------
  const counts = {
    clients: clients.length,
    client_tags: clientTags.length,
    test_users: testUsers.length
  };
  if (clientIds.length) {
    counts.jobs = (await scalar(`SELECT COUNT(*)::int AS n FROM jobs WHERE client_id = ANY($1::bigint[])`, [clientIds])).n;
    counts.payments = (await scalar(`SELECT COUNT(*)::int AS n FROM payments WHERE client_id = ANY($1::bigint[])`, [clientIds])).n;
    counts.notes = (await scalar(`SELECT COUNT(*)::int AS n FROM notes WHERE client_id = ANY($1::bigint[])`, [clientIds])).n;
    counts.margin_entries = (await scalar(`SELECT COUNT(*)::int AS n FROM finance_margin_entries WHERE client_id = ANY($1::bigint[]) OR job_id = ANY($2::bigint[])`, [clientIds, jobIds])).n;
    counts.adjustments = (await scalar(`SELECT COUNT(*)::int AS n FROM finance_adjustments WHERE client_id = ANY($1::bigint[]) OR job_id = ANY($2::bigint[])`, [clientIds, jobIds])).n;
  }
  if (jobIds.length) {
    counts.line_items = (await scalar(`SELECT COUNT(*)::int AS n FROM job_line_items WHERE job_id = ANY($1::bigint[])`, [jobIds])).n;
    counts.job_tags = (await scalar(`SELECT COUNT(*)::int AS n FROM job_tags WHERE job_id = ANY($1::bigint[])`, [jobIds])).n;
    counts.notifications = (await scalar(`SELECT COUNT(*)::int AS n FROM notifications WHERE job_id = ANY($1::bigint[]) OR client_id = ANY($2::bigint[])`, [jobIds, clientIds])).n;
  } else {
    counts.notifications = (await scalar(`SELECT COUNT(*)::int AS n FROM notifications WHERE client_id = ANY($1::bigint[])`, [clientIds])).n;
  }
  counts.activity = (await scalar(`SELECT COUNT(*)::int AS n FROM activity_log WHERE actor_email IN ('admin@test','normal@user.test')`)).n;

  console.log('=== Would delete ===');
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);

  console.log('\n=== Sample clients ===');
  clients.slice(0, 25).forEach((c) => console.log(`  #${c.id}  ${c.name}  (${c.status}, ${c.phone})`));
  console.log('=== Sample client tags ===');
  clientTags.slice(0, 25).forEach((t) => console.log(`  #${t.id}  ${t.name}`));
  console.log('=== Test app_users ===');
  testUsers.forEach((u) => console.log(`  #${u.id}  ${u.email}  (${u.role})`));

  if (!EXECUTE) {
    console.log('\nNothing deleted. Re-run with --execute to delete.');
    return;
  }

  // ---- Delete (single transaction) ------------------------------------------
  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');

    if (clientIds.length) {
      await conn.query(`DELETE FROM notifications WHERE client_id = ANY($1::bigint[]) OR job_id = ANY($2::bigint[])`, [clientIds, jobIds]);
      await conn.query(`DELETE FROM finance_margin_entries WHERE client_id = ANY($1::bigint[]) OR job_id = ANY($2::bigint[])`, [clientIds, jobIds]);
      await conn.query(`DELETE FROM finance_adjustments WHERE client_id = ANY($1::bigint[]) OR job_id = ANY($2::bigint[])`, [clientIds, jobIds]);
      // clients CASCADE -> jobs, payments, notes; jobs CASCADE -> job_line_items, job_tags.
      const delClients = await conn.query(`DELETE FROM clients WHERE id = ANY($1::bigint[])`, [clientIds]);
      counts.deleted_clients = delClients.rowCount;
    }
    if (tagIds.length) {
      const delTags = await conn.query(`DELETE FROM tags WHERE id = ANY($1::bigint[])`, [tagIds]);
      counts.deleted_tags = delTags.rowCount;
    }
    const delUsers = await conn.query(`DELETE FROM app_users WHERE id IN (999000, 999001)`);
    counts.deleted_users = delUsers.rowCount;
    await conn.query(`DELETE FROM activity_log WHERE actor_email IN ('admin@test','normal@user.test')`);

    await conn.query('COMMIT');
    console.log('\n=== Deleted ===');
    for (const [k, v] of Object.entries(counts)) if (k.startsWith('deleted_')) console.log(`  ${k}: ${v}`);
    console.log('Done. Smoke-test data removed.');
  } catch (err) {
    await conn.query('ROLLBACK');
    throw err;
  } finally {
    conn.release();
  }
}

main()
  .catch((err) => {
    console.error('Cleanup failed:', err);
    process.exit(1);
  })
  .finally(() => pool.end());
