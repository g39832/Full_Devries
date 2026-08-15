# Local Testing Guide (Roofing CRM / DeVries)

This project talks to a **Postgres database**. In production that's the Supabase
project, but you can (and should) run and test the app locally **without touching
production data**.

> **Important:** since the Jobs/Tags/Roles rework, the test suite covers the
> full required scenario (no duplicate clients, job photos, tag filtering,
> idempotent approval, finance math, overpayments, admin roles, notifications).
> It still refuses to run against `DATABASE_URL` (production).

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
`BACKUP_ALLOW_PRODUCTION=true`. **The smoke test creates and deletes real rows.**
Use a test DB.

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

## 3. Run the app locally

```bash
npm start
# -> Server running on http://localhost:3000
```

- Sign in with a Google account — the login page is Google-only. Only emails
  listed in `ADMIN_EMAILS` are admins; there is no automatic first-login admin.
  Admins can promote/demote other users in Settings → Users.
- The app's schema is created automatically on first boot (`api/db.js` →
  `initSchema()`): `settings`, `clients`, `jobs`, `payments`, `notes`,
  `finance_overrides`, `finance_margin_entries`, `tags`, `job_tags`,
  `app_users`, `finance_adjustments`, `notifications`.

### Safe local dev server (never touches production data)

```bash
npm run dev
# -> Server running on http://localhost:3001
```

`npm run dev` **refuses to start** unless `TEST_DATABASE_URL` is set, so it can
never accidentally connect to the production `DATABASE_URL`.

## 4. Run the test suites

Both suites are **guarded**: they refuse to run against `DATABASE_URL`
(production) unless you explicitly set `SMOKE_ALLOW_PRODUCTION=true` /
`BACKUP_ALLOW_PRODUCTION=true`.

### Smoke test (login, clients, jobs, photos, tags, approval, finance, roles, notifications)

```bash
npm run test:smoke
```

What it does (all against the **test** DB):
1. Boots the real server on port 3000 in `NODE_ENV=test`.
2. Asserts unauthenticated API access is rejected (401).
3. Bootstraps an admin session (login is Google-only now), checks `/api/auth/me` reports admin.
4. Creates client "John Smith", adds Jobs 1/2/3, and **asserts the client was
   never duplicated** and all jobs belong to the same client.
5. Asserts a payment is **rejected before approval**, then approves the job
   (and re-approves to prove idempotency — no duplicate finance records or
   duplicate "approved" notifications).
6. Records a payment and an expense, then asserts
   `Total Due − Paid = Balance Due`, `Paid − Expenses = Profit`, and
   `Profit ÷ Paid × 100 = Margin %` are computed server-side.
7. Enters an overpayment and asserts **Balance Due = $0 (never negative)** and
   the Overpayment/Credit equals the excess.
8. Tags: creates "Prospect", rejects a case-insensitive duplicate (409), tags
   two jobs, filters by tag, renames the tag (relationships preserved), deletes
   the tag (jobs intact).
9. Photos: uploads an image to Job 1 and asserts it is **not** visible on
   Job 2 (scoped storage keys).
10. Notifications: asserts approval/payment/overpayment notifications exist.
11. Admin: applies a finance adjustment and verifies the audit trail
    (old value, new value, reason, who). Then swaps the session to a **normal
    user** and asserts admin endpoints return **403** (finance adjustment, tag
    creation, user list).
12. Regression: client notes, job-scoped notes, client-level PDF upload/list/
    delete (when storage is configured), finance years + summary, and logout →
    401.

### Backup / restore verification

```bash
npm run test:backup-restore
```

Validates a JSON backup contains all tables (`settings`, `clients`, `jobs`,
`payments`, `notes`, `finance_overrides`, `finance_margin_entries`, `tags`,
`job_tags`, `app_users`, `finance_adjustments`, `notifications`).

## 5. Read-only production inspection scripts

These never write and never read row contents (schema + counts only):

```bash
node scripts/inspect-schema.js            # tables/columns/FKs from information_schema
ALLOW_PRODUCTION_AUDIT=true node scripts/inspect-data-counts.js  # row counts per table
```

## 6. What still needs manual verification

- **Google login** cannot be exercised by the automated suite (it needs a
  real Supabase Google provider). Follow `MANUAL-STEPS.md` to configure Google
  Cloud + Supabase + Render, then test: login page → "Continue with Google" →
  Google consent → redirected back → `/main`.
- **Email notifications** are off by default (`EMAIL_NOTIFICATIONS_ENABLED`).
  In-app notifications work immediately.
