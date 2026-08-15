// scripts/dry-run-migration.js
// ============================================================
// SAFE MIGRATION DRY-RUN
// Runs supabase-migration-v2-jobs-finance.sql inside a single
// transaction and ROLLS IT BACK. Nothing persists. This verifies
// the SQL is valid against the actual database without touching
// production data.
//
// Usage:  node scripts/dry-run-migration.js
// ============================================================
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  const url = process.env.NODE_ENV === 'test' && process.env.TEST_DATABASE_URL
    ? process.env.TEST_DATABASE_URL
    : process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL / TEST_DATABASE_URL set.');
    process.exit(1);
  }
  if (!process.env.ALLOW_MIGRATION_DRYRUN && process.env.NODE_ENV !== 'test') {
    console.log('Set ALLOW_MIGRATION_DRYRUN=true to dry-run against DATABASE_URL.');
    process.exit(0);
  }

  const sqlPath = path.resolve(__dirname, '..', 'supabase-migration-v2-jobs-finance.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    console.log('Beginning dry-run (will ROLLBACK)...');
    await client.query('BEGIN');
    await client.query(sql);
    // Verify the key objects exist before rolling back
    const tables = ['jobs', 'tags', 'job_tags', 'app_users', 'finance_adjustments', 'notifications'];
    for (const t of tables) {
      const { rows } = await client.query(
        'SELECT to_regclass($1) AS cls',
        [`public.${t}`]
      );
      if (!rows[0]?.cls) throw new Error(`Table ${t} was not created`);
    }
    const cols = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='job_id'`
    );
    if (!cols.rows.length) throw new Error('payments.job_id was not added');
    const jobsCount = await client.query('SELECT COUNT(*)::int AS n FROM public.jobs');
    console.log(`  jobs rows created (will roll back): ${jobsCount.rows[0].n}`);
    await client.query('ROLLBACK');
    console.log('DRY-RUN PASSED — migration SQL is valid; nothing was persisted.');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('DRY-RUN FAILED (rolled back):', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
