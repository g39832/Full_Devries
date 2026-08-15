// scripts/dev-server.js
// ============================================================
// SAFE LOCAL DEV SERVER
// ============================================================
// Run with:  npm run dev
//
// This intentionally NEVER connects to the production
// DATABASE_URL. It refuses to start unless TEST_DATABASE_URL is
// set in .env (a dedicated test database — a second Supabase
// project or a local Postgres). See TESTING.md for setup.
//
// If you want the app pointed at production data, use `npm start`
// instead — `npm run dev` is for safe local testing only.
// ============================================================
require('dotenv').config();

if (!process.env.TEST_DATABASE_URL) {
  console.error(
    '\n' +
    'Refusing to start the dev server against DATABASE_URL (production).\n' +
    '\n' +
    'Set TEST_DATABASE_URL in .env to a dedicated test database, then run\n' +
    '`npm run dev` again. See TESTING.md for setup options:\n' +
    '  Option A: a free second Supabase project (recommended)\n' +
    '  Option B: a local Postgres via Docker\n' +
    '\n' +
    'Never point TEST_DATABASE_URL at your production database.\n'
  );
  process.exit(1);
}

// Extra hardening: never let a copy/paste mistake silently point the dev
// server at the production database.
function normalizeDbUrl(u) {
  return String(u || '').trim().replace(/\/+$/, '');
}

if (
  process.env.DATABASE_URL &&
  normalizeDbUrl(process.env.TEST_DATABASE_URL) === normalizeDbUrl(process.env.DATABASE_URL)
) {
  console.error(
    '\n' +
    'TEST_DATABASE_URL appears to be the SAME database as DATABASE_URL\n' +
    '(production). Refusing to start the dev server against production.\n' +
    'Point TEST_DATABASE_URL at a dedicated test database (see TESTING.md).\n'
  );
  process.exit(1);
}

// Show which database the dev server will use (credentials stripped).
try {
  const testDbUrl = new URL(process.env.TEST_DATABASE_URL);
  console.log(`[dev] Using test database at ${testDbUrl.host}${testDbUrl.pathname}`);
} catch (_) {
  // Non-URL connection strings (e.g. supabase pooler) — skip the friendly log.
}

// Route the DB layer to TEST_DATABASE_URL (api/db.js checks NODE_ENV === 'test').
process.env.NODE_ENV = 'test';
// No backup scheduler noise while developing.
process.env.ENABLE_DB_BACKUPS = 'false';
// Default to a port that won't clash with `npm start` (3000). Override with DEV_PORT.
process.env.PORT = process.env.DEV_PORT || '3001';

require('../server').startServer();
