# Local Testing Guide (Roofing CRM / DeVries)

This project talks to a **Postgres database**. In production that's the Supabase
project, but you can (and should) run and test the app locally **without touching
production data**.

---

## 1. Prerequisites

- Node.js 22+ (per `package.json` `engines`)
- `npm install` from this folder
- A Postgres database **for testing** — pick one option below:

### Option A (recommended): a second Supabase project
Create a **free second Supabase project** (e.g. `devries-test`) and grab its
Postgres connection string from Supabase → Settings → Database → Connection
string (URI). You never point this project at production data.

### Option B: local Postgres (Docker)
```bash
docker run --name devries-test-db -e POSTGRES_PASSWORD=testpass -e POSTGRES_DB=devries_test -p 5433:5432 -d postgres:16
```

### Option C (advanced): run tests against production
Only if you fully understand the risk. Set `SMOKE_ALLOW_PRODUCTION=true` and/or
`BACKUP_ALLOW_PRODUCTION=true`. **The smoke test creates and deletes a real
client + notes + payment in whatever DB it points at.** Use a test DB.

---

## 2. Environment setup

Copy `.env.example` to `.env` (or edit the existing `.env`), and make sure you
have **two separate** values:

```env
# Production / default DB (used by `npm start`)
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DBNAME?sslmode=require

# Test DB (used ONLY by the test scripts — never points at production)
TEST_DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DBNAME?sslmode=require
```

> ⚠️ **Never set `TEST_DATABASE_URL` to the same database as `DATABASE_URL`.**
> The test scripts create and delete real rows.

Optional but recommended for local dev:
```env
PORT=3000
ENABLE_DB_BACKUPS=false
```

---

## 3. Run the app locally

```bash
npm start
# -> Server running on http://localhost:3000
```

- Log in with the admin password (`123007` in the current dev setup, or the
  value stored in the `admin_password` settings row).
- The app's schema (`settings`, `clients`, `payments`, `notes`,
  `finance_overrides`, `finance_margin_entries`) is created automatically on
  first boot (`api/db.js` → `initSchema()`).

### Safe local dev server (never touches production data)

```bash
npm run dev
# -> Server running on http://localhost:3001
```

`npm run dev` **refuses to start** unless `TEST_DATABASE_URL` is set, so it can
never accidentally connect to the production `DATABASE_URL`. It also disables
backups and uses port 3001 (override with `DEV_PORT`) so it won't clash with
`npm start`. Use `npm start` only when you intentionally want the production
DB.

---

## 4. Run the test suites

Both suites are **guarded**: they refuse to run against `DATABASE_URL`
(production) unless you explicitly set `SMOKE_ALLOW_PRODUCTION=true` /
`BACKUP_ALLOW_PRODUCTION=true`.

### Smoke test (login, clients, payments, notes, optional PDFs)

```bash
npm run test:smoke
```

What it does:
1. Boots the real server on port 3000 in `NODE_ENV=test` (uses `TEST_DATABASE_URL`).
2. Asserts unauthenticated API access is rejected (401).
3. Logs in, creates a client, records a payment, adds/lists a note, deletes the client.
4. If remote storage is configured (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
   set and `STORAGE_BACKEND != local`), it also uploads/lists/deletes a PDF.
   Otherwise those steps are skipped with a warning — so the suite passes locally
   without storage config.

### Backup / restore verification

```bash
npm run test:backup-restore
```

What it does:
1. Creates a JSON backup (`backups/crm-backup-*.json`) from the **test** DB.
2. Validates the JSON structure and that all required tables (`settings`,
   `clients`, `payments`, `notes`, `finance_overrides`) are present with
   well-formed rows.

---

## 5. What's NOT covered by the automated tests

A few functional gaps were fixed in the app itself (July/Aug 2026):

- **PDF upload/list/delete now works without Supabase storage.** `storage.js`
  falls back to the local `uploads/` folder when `SUPABASE_URL` /
  `SUPABASE_SERVICE_ROLE_KEY` aren't set, so all PDF features work out of the
  box locally. When you do configure Supabase storage (set the env vars and
  create the bucket), uploads go to the cloud instead.
- **New leads are saved with status `Prospect`** (was `Lead`, which the app's
  status list doesn't include). The sidebar counts, colors, and status dropdown
  all understand `Prospect`.
- **Margin Tracker now factors in `clients.job_cost`** for both per-client rows
  and aggregate totals, so margins match the finance page's Avg Margin instead
  of reporting ~100% for everyone.
- **Finance "Select Year" is now a real dropdown** populated from the database
  years, and the margin tracker stays in sync when it changes.
- **Forecast panel no longer shows absurd slope percentages** — it displays a
  dash when projected revenue is 0.
- **Cross-year payments refresh both years' finance totals** (the payment year
  and the client's creation year).
- **Finance page drop zones now actually accept dropped PDFs** (they only
  advertised it before).

Still worth knowing before deploying:

- **`vercel.json` rewrites `/api/*` to `https://${BACKEND_URL}/api/*`** — before
  deploying to Vercel, set a `BACKEND_URL` environment variable in your Vercel
  project to your backend host (e.g. `myapp.onrender.com`, no `https://`).
  Without it, `/api/*` calls fail on the Vercel site.
- `finance_margin_entries` is now included in JSON backups (along with
  `settings, clients, payments, notes, finance_overrides`).
