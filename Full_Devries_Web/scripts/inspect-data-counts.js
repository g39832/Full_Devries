// scripts/inspect-data-counts.js
// READ-ONLY data audit: counts and aggregates only. Never reads row contents,
// never writes. Run: node scripts/inspect-data-counts.js
require('dotenv').config();
const { Pool } = require('pg');

async function main() {
  const url = process.env.NODE_ENV === 'test' && process.env.TEST_DATABASE_URL
    ? process.env.TEST_DATABASE_URL
    : process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL / TEST_DATABASE_URL set.');
    process.exit(1);
  }
  if (process.env.NODE_ENV !== 'test' && !process.env.ALLOW_PRODUCTION_AUDIT) {
    console.log('Production audit requires ALLOW_PRODUCTION_AUDIT=true to run against DATABASE_URL.');
    process.exit(0);
  }

  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  try {
    const queries = [
      ['clients_total', 'SELECT COUNT(*)::int AS n FROM clients'],
      ['clients_by_status', 'SELECT status, COUNT(*)::int AS n FROM clients GROUP BY status ORDER BY n DESC'],
      ['payments_total', 'SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0) AS total FROM payments'],
      ['payments_negative', 'SELECT COUNT(*)::int AS n FROM payments WHERE amount < 0'],
      ['notes_total', 'SELECT COUNT(*)::int AS n FROM notes'],
      ['margin_entries_total', 'SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0) AS total FROM finance_margin_entries'],
      ['overrides_total', 'SELECT COUNT(*)::int AS n FROM finance_overrides'],
      ['clients_with_payments', 'SELECT COUNT(DISTINCT client_id)::int AS n FROM payments'],
      ['clients_with_notes', 'SELECT COUNT(DISTINCT client_id)::int AS n FROM notes'],
      ['clients_with_entries', 'SELECT COUNT(DISTINCT client_id)::int AS n FROM finance_margin_entries WHERE client_id IS NOT NULL']
    ];
    for (const [label, sql] of queries) {
      const { rows } = await pool.query(sql);
      console.log(`${label}:`, JSON.stringify(rows[0]));
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
