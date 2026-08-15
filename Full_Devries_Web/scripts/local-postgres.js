// scripts/local-postgres.js
// ============================================================
// FULLY LOCAL TEST DATABASE — no Docker, no Supabase, no cloud.
//
// Uses the `embedded-postgres` package (real Postgres binaries
// downloaded by npm, run from this project) so you can test the
// whole app offline. Data lives in <project>/.local-db/ and is
// gitignored.
//
// Usage:
//   npm run db:local            # start postgres, stay running (Ctrl+C stops it)
//   npm run dev:local           # start postgres, then run the dev server (3001)
//   npm run test:smoke:local    # start postgres, run the full smoke test, stop
// ============================================================
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const EmbeddedPostgres = require('embedded-postgres').default;

const projectRoot = path.resolve(__dirname, '..');
const dataDir = path.join(projectRoot, '.local-db', 'pgdata');
const envPath = path.join(projectRoot, '.env');
const port = Number(process.env.LOCAL_PG_PORT || 55432);
const user = 'postgres';
const password = 'postgres';
const database = 'crm_test';
const connectionUrl = `postgresql://${user}:${password}@127.0.0.1:${port}/${database}`;

let pg = null;
let childProc = null;

function log(msg) {
  console.log(`[local-pg] ${msg}`);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Wait until the database accepts connections.
async function waitForReady(timeoutMs = 60000) {
  const { Client } = require('pg');
  // Probe against the maintenance database — crm_test may not exist yet.
  const probeUrl = `postgresql://${user}:${password}@127.0.0.1:${port}/postgres`;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const client = new Client({ connectionString: probeUrl, ssl: false, connectionTimeoutMillis: 2000 });
    try {
      await client.connect();
      await client.end();
      return true;
    } catch (_) {
      try { await client.end(); } catch (_) {}
      await sleep(500);
    }
  }
  throw new Error('Timed out waiting for local Postgres to start');
}

// ============================================================
// Stale-postmaster cleanup
//
// On Windows, force-killing Postgres (taskkill /f) can leave a stale
// postmaster.pid behind, and a recycled PID can make Postgres refuse to start
// ("lock file already exists"). This tool owns the port (LOCAL_PG_PORT) and the
// data dir (.local-db), so a postmaster referenced by OUR lock file is by
// definition a leftover local instance — safe to kill and clean up.
// ============================================================
function killPidTree(pid) {
  return new Promise((resolve) => {
    const child = spawn('taskkill', ['/F', '/T', '/PID', String(pid)], { shell: true, stdio: 'ignore' });
    child.on('close', () => resolve());
    child.on('error', () => resolve());
  });
}

async function clearStalePostmaster() {
  const pidFile = path.join(dataDir, 'postmaster.pid');
  if (!fs.existsSync(pidFile)) return;
  const lines = fs.readFileSync(pidFile, 'utf8').split(/\r?\n/);
  const pid = (lines[0] || '').trim();
  const lockDataDir = (lines[1] || '').trim();
  // Only touch locks that belong to OUR data dir (or that omit the dir line).
  if (lockDataDir && path.resolve(lockDataDir) !== path.resolve(dataDir)) {
    return;
  }
  if (/^\d+$/.test(pid)) {
    await killPidTree(pid);
  }
  try {
    fs.unlinkSync(pidFile);
    log(`Cleared stale postmaster lock (PID ${pid || 'unknown'}).`);
  } catch (_) {}
}

async function startPostgres() {
  log(`Starting embedded Postgres on port ${port} (data dir: ${dataDir})`);
  pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user,
    password,
    port,
    persistent: true
  });

  const alreadyInitialised = fs.existsSync(path.join(dataDir, 'PG_VERSION'));
  if (!alreadyInitialised) {
    log('Initialising data directory (first run, takes a moment)...');
    await pg.initialise();
  }
  await clearStalePostmaster();
  try {
    await pg.start();
  } catch (err) {
    throw new Error('Postgres failed to start: ' + ((err && err.message) || err || 'unknown error') + ' (possible port conflict or stale process)');
  }
  await waitForReady();
  log('Postgres is up.');

  try {
    await pg.createDatabase(database);
    log(`Ensured database "${database}".`);
  } catch (err) {
    // Already exists is fine.
    if (!/already exists/i.test(String(err.message || err))) {
      console.warn(`[local-pg] createDatabase warning: ${err.message}`);
    }
  }

  // Point the app's test DB at this local instance (replace or add the line,
  // leaving every other line in .env untouched).
  let envContent = '';
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }
  const line = `TEST_DATABASE_URL=${connectionUrl}`;
  if (/^TEST_DATABASE_URL=.*$/m.test(envContent)) {
    envContent = envContent.replace(/^TEST_DATABASE_URL=.*$/m, line);
  } else {
    envContent = envContent.replace(/\s*$/, '\n') + line + '\n';
  }
  fs.writeFileSync(envPath, envContent, 'utf8');
  log(`Wrote TEST_DATABASE_URL into .env (${connectionUrl})`);
  log('Ready. For the smoke test run:  npm run test:smoke   |   For the app run:  npm run dev');
}

async function stopPostgres() {
  const pidFile = path.join(dataDir, 'postmaster.pid');
  let postmasterPid = null;
  if (fs.existsSync(pidFile)) {
    const first = fs.readFileSync(pidFile, 'utf8').split(/\r?\n/)[0].trim();
    if (/^\d+$/.test(first)) postmasterPid = first;
  }
  if (pg) {
    try {
      await Promise.race([
        pg.stop(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('stop timed out')), 8000))
      ]);
      log('Postgres stopped.');
    } catch (err) {
      console.warn('[local-pg] stop warning:', (err && err.message) || err);
    }
    pg = null;
  }
  // Reliable fallback: force-kill the postmaster tree and drop the lock so the
  // next start is clean (taskkill inside embedded-postgres can fail silently).
  if (postmasterPid) { try { await killPidTree(postmasterPid); } catch (_) {} }
  try { fs.unlinkSync(pidFile); } catch (_) {}
}

async function main() {
  const [subcommand, ...rest] = process.argv.slice(2);

  if (subcommand === 'start') {
    await startPostgres();
    log('Running in foreground — press Ctrl+C to stop Postgres.');
    const shutdown = async () => {
      await stopPostgres();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    // Keep alive.
    await new Promise(() => {});
  } else if (subcommand === 'run') {
    if (!rest.length) {
      console.error('Usage: node scripts/local-postgres.js run <command...>');
      process.exit(1);
    }
    await startPostgres();
    const cmd = rest[0];
    const args = rest.slice(1);
    log(`Running: ${cmd} ${args.join(' ')}`);
    // shell:false so we run the command directly. Spawning `npm` through a
    // shell on Windows can return early (cmd.exe chains .cmd batch files),
    // which used to stop Postgres while the dev server was still starting.
    childProc = spawn(cmd, args, {
      stdio: 'inherit',
      shell: false,
      env: { ...process.env, TEST_DATABASE_URL: connectionUrl }
    });
    const exitCode = await new Promise((resolve) => {
      childProc.on('exit', (code) => resolve(code));
      childProc.on('error', (err) => {
        console.error('[local-pg] command error:', (err && err.message) || err);
        resolve(1);
      });
      // Forward Ctrl+C / termination to the child and always stop Postgres.
      const forward = () => {
        if (!childProc.killed) { try { childProc.kill(); } catch (_) {} }
        resolve(0);
      };
      process.on('SIGINT', forward);
      process.on('SIGTERM', forward);
    });
    await stopPostgres();
    process.exit(exitCode === null ? 1 : exitCode);
  } else {
    console.log(`
Usage:
  npm run db:local            start local Postgres (stays running; Ctrl+C to stop)
  npm run dev:local           start local Postgres + the dev server on :3001
  npm run test:smoke:local    start local Postgres, run the smoke test, stop

The local database is written to ${dataDir} and never touches production.
`);
  }
}

main().catch(async (err) => {
  console.error('[local-pg] ERROR:', (err && err.message) || err);
  await stopPostgres();
  process.exit(1);
});
