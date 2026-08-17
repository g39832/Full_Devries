# FINAL REPORT — Client/Job, Finance, Tags, Roles, Google Login, Notifications

> **Latest changes (Aug 15):**
> 1. **Login is now Google-only.** The password form, password reset, and the
>    `/api/login` + `/api/change-password` endpoints are removed. Everyone signs
>    in with "Continue with Google". Only emails in `ADMIN_EMAILS` are admins
>    (no automatic first-login admin); admins can promote/demote users in
>    Settings → Users.
> 2. **Admin Activity Log.** New `activity_log` table + middleware records every
>    successful change (who, what, when) across clients, jobs, payments,
>    expenses, tags, notes, files, and admin actions. Admins view it under
>    Settings → Activity (normal users get 403 at the API level).

> **Latest changes (Aug 17) — Client/Job workspace + real authorization:**
> 1. **Sales-person assignment** (`jobs.sales_user_id` → `app_users.id`, never
>    free text). Admins assign a sales person per job in the Client/Job
>    Workspace and can filter all jobs by sales person in the header.
> 2. **Two tag systems:** primary **client tag** (one per client, sorts the
>    client list) vs secondary **job tags** (many per job). Both are clickable,
>    database-filtered, and clearable; tag creation in Settings picks a kind.
> 3. **Real backend authorization.** Restricted/sales users can only see and
>    modify jobs assigned to them (`sales_user_id`); admins see everything.
>    Every jobs/clients/notes route enforces this server-side (RLS does not
>    apply — the app talks to Postgres directly as the DB owner).
> 4. **Job-scoped estimates/invoices with line items** (`job_line_items`),
>    editable per job, and **copied into a new job** (scope + line items +
>    pricing) via "Duplicate" or "Copy scope & pricing from…". The original job
>    is never touched.
> 5. **Notes now record their author** and fire a **targeted** in-app
>    notification + email (author, client, job, preview, timestamp, link) to the
>    assigned sales person and admins — per-user unread state and
>    click-to-navigate.
> 6. **Progressive disclosure + mobile pass** — collapsible sections, a client
>    meta strip, and iPhone tap-target/overflow fixes.
>
> New migration: `supabase-migration-v3-workspaces.sql` (additive; the app also
> applies it automatically on boot). New env var: `APP_URL` (links in emails).

## What was built

The CRM now treats **Clients** and **Jobs** as separate records (1 Client ── many
Jobs), with job-level photos/tags/notes/finance, a transaction-based finance
engine with overpayments, an admin role system with a full audit trail, a
database-backed tag system, in-app notifications, and a Google login option —
all additive and backward-compatible with the existing production data.

## Features completed

1. **Client ⇄ Job model.** `jobs` table with `client_id` FK (ON DELETE CASCADE).
   "Add Job" inserts a Job row — it can never create a duplicate client.
2. **Jobs as first-class records.** Each job has its own status, address, scope,
   job cost, totals, tags, photos, notes, payments, expenses, and finance. Add a
   job to a client, list all jobs, open/edit a job, and navigate back to the
   parent client.
3. **Margin + Scoop rework.** Job-level data is authoritative. Client-level
   finance (Total Due, Paid, Balance, Overpayment, Expenses, Profit, Margin) is
   **aggregated from jobs at read time** — no duplicated totals that can drift.
   Legacy client cache columns stay in sync via DB triggers so existing readers
   (PDF invoices, margin tracker, finance page) keep working.
4. **Job-level photos.** Photos/PDFs upload to `job-<jobId>/...` storage keys,
   scoped per job. Each migrated default job keeps its `legacy_storage_key`
   (`<clientId>`), so **existing photos remain visible** on the default job.
   Storage stays non-public; access is via signed URLs through the backend.
5. **Google login.** "Continue with Google" on the login page (Supabase Auth
   Google provider, PKCE). The backend re-verifies the Supabase session
   server-side before opening a CRM session. The existing password login is
   preserved. **Requires your manual Google Cloud + Supabase + Render setup —
   see MANUAL-STEPS.md; until then the button shows "not configured".**
6. **Admin role system.** `app_users` table (Normal User vs Admin). Roles are
   enforced **server-side** (Express `requireRole('admin')` middleware on all
   `/api/admin/*`, tag writes, finance adjustments) and via RLS on new tables
   (no anon policies). Frontend hiding is only cosmetic.
7. **Admin finance override.** `finance_adjustments` audit table: who, when,
   original value, new value, reason, and the associated client/job/record.
   Admin-only. Normal users get 403 at the API level.
8. **Tag system.** DB-backed `tags` + `job_tags`, case-insensitive unique
   (duplicates rejected with 409). Tags are clickable everywhere and filter all
   jobs. Settings → Tags (admin): add, rename (relationships preserved), remove
   (jobs untouched). Attaching/removing tags on a job is allowed for any
   authenticated user.
9. **Finance rework.** Payments and expenses are individual transaction records
   (`payments`, `finance_margin_entries`), each linked to a job. All balances
   are computed server-side: `Total Due − Paid = Balance Due`,
   `Paid − Expenses = Profit`, `Profit ÷ Paid × 100 = Margin %`. Client-level
   finance aggregates across jobs; job-level is drill-down specific.
10. **Approval → Finance rule.** Finance tracking is locked until a job reaches
    an approved status (Approved/Completed/Invoice/Closed). Payments/expenses on
    unapproved jobs are rejected with a clear message. Approval is idempotent —
    approving twice creates no duplicate finance records and no duplicate
    notifications.
11. **Overpayments.** Balance Due is always `max(0, due − paid)` — never a
    negative balance. The excess is shown as **Overpayment/Credit**.
12. **Notifications.** In-app notifications for high-value events: client/job
    awaiting approval, approved, new job, payment received, overpayment,
    expense recorded, and a derived "needs attention" item for jobs stuck
    pending 7+ days. A bell in the header shows unread count and the list.
    Optional email via the existing SMTP sender when
    `EMAIL_NOTIFICATIONS_ENABLED=true` (free method, nodemailer lazily loaded).
13. **Supabase migration discipline.** `supabase-migration-v2-jobs-finance.sql`
    is additive, idempotent, preserves every existing record, provides rollback
    SQL, and was **dry-run against the live database inside a rolled-back
    transaction** (validated: 83 default jobs backfilled, zero footprint).
14. **Render.** No code change required; env vars and deploy steps are listed in
    MANUAL-STEPS.md (see "Render changes required" below).

## Files changed

Backend:
- `api/db.js` — schema bootstrap for local/test DBs (jobs, tags, app_users,
  finance_adjustments, notifications, backfills, triggers)
- `api/auth.js` — app_users + roles, Google session verification, logout, /me
- `api/jobs.js` *(new)* — job CRUD, job finance, expenses, payments history,
  tags, photos, tag search, client aggregation
- `api/tags.js` *(new)* — tag CRUD (admin writes, case-insensitive unique)
- `api/admin.js` *(new)* — finance adjustments + audit, user role management
- `api/notifications.js` *(new)* + `services/notifications.js` *(new)*
- `api/clients.js` — default job on save; legacy endpoints now operate on the
  default job; finance summary aggregates from jobs; search returns job_count
- `api/notes.js` — job-scoped notes
- `api/pdf.js` — job photo keys + image support
- `server.js` — mounts new routers, public API paths, session store exposure
- `services/db-backup.js` — backs up all new tables
- `scripts/smoke-test.js` — full scenario coverage
- `scripts/dry-run-migration.js`, `scripts/inspect-schema.js`,
  `scripts/inspect-data-counts.js` *(new, read-only)*
- `supabase-migration-v2-jobs-finance.sql` *(new)*
- `package.json` — `nodemailer` (optional)

Frontend:
- `login.html` / `login.js` / `login.css` — Google login button + handling
- `auth-callback.html` *(new)* — OAuth PKCE callback → server session
- `main.html` — Settings button, notifications bell, user badge, tag filter bar,
  Settings modal, notifications panel
- `main-renderer.js` — statuses, state, tag-mode sidebar, Esc handling
- `main-renderer-v2.js` *(new)* — Client panel (contact + jobs + aggregate
  finance) and Job panel (details, tags, photos, notes, finance, overpayments,
  admin adjustment)
- `main-renderer-v3.js` *(new)* — session/roles, tag filter bar, notifications,
  Settings modal, logout
- `style.css` — new component styles

Docs: `MANUAL-STEPS.md`, `FINAL-REPORT.md`, updated `TESTING.md`,
`.env.example`.

## Database changes

New tables: `jobs`, `tags`, `job_tags`, `app_users`, `finance_adjustments`,
`notifications`. New columns: `payments.job_id`, `notes.job_id`,
`finance_margin_entries.job_id`. New indexes, 3 triggers (payments→job finance,
total_due→balance, jobs→client cache), RLS enabled on new tables. Backfills:
one default job per client; `job_id` backfilled on all existing
payments/notes/margin entries; legacy negative balances normalized to
Overpayment (balance never < 0).

## Authentication behavior

- Password login → admin session (as before), now backed by an `app_users` row
  used for the audit trail.
- Google login → Supabase OAuth → backend verifies the token against Supabase →
  upserts `app_users` → CRM session with role.
- Role resolution: emails in `ADMIN_EMAILS`/`admin_emails` setting are admins
  on login; admins can promote/demote other users in Settings → Users
  (promotions persist across logins); everyone else defaults to `user`.
- `GET /api/auth/me` exposes the role to the UI; `POST /api/auth/logout`
  destroys the session; protected routes require a session (401).

## Admin role + finance override

All `/api/admin/*` routes require `role === 'admin'` in the session (403 for
normal users, 401 unauthenticated). The adjustment flow records
`finance_adjustments` with record type, record id, field, old/new values,
reason, and who. Payment adjustments post a corrective delta transaction (like
the app's existing undo mechanics) so history is preserved, never rewritten.

## Client → multiple Jobs explanation

`clients` keeps customer identity (name, phone, email, address). Job-level
fields moved to `jobs`. Every existing client got one default job carrying its
old data (verified in the dry-run: 83/83). "Add Job" inserts a new `jobs` row
for the same `client_id` — the client row is never touched, so duplicates are
impossible by construction.

## Margin/Scoop aggregation explanation

`GET /api/jobs/:id` returns the job's computed finance (from transactions).
Client panels and `GET /api/clients/:id/jobs` aggregate by summing each job's
computed values. Legacy `clients.total_due/amount_paid/balance/job_cost` are
kept as a DB-trigger-synced cache so old readers (invoices, margin tracker,
finance page) stay correct without ever being written by new code paths.

## Finance behavior

- Payments/expenses only after approval (server-enforced).
- Every payment is a `payments` row (with `job_id`); every expense is a
  `finance_margin_entries` row (with `job_id`); totals are computed, never
  stored per transaction.
- Undo/restore posts a delta payment row (same mechanic as the original app).
- Overpayment: `balance_due = max(0, due − paid)`, `overpayment = max(0, paid −
  due)`; the UI highlights the credit and never shows a negative balance.
- Admin adjustments post corrective deltas and log the audit row.

## Tag system explanation

`tags(name unique lower)` + `job_tags(job_id, tag_id)` composite PK. Renaming a
tag only touches `tags.name` (relationships intact). Deleting cascades only
`job_tags` rows. Duplicate creation (any casing) returns 409. Filtering is
server-side (`GET /api/jobs?tag_id=N`).

## Photo storage/access explanation

Storage keys: `job-<jobId>/<timestamp>-<name>` for new uploads; legacy
`<clientId>/...` remain reachable via the default job's `legacy_storage_key`.
Bucket stays private; the backend issues signed URLs. Upload/delete go through
the backend (authenticated). Images and PDFs are supported. RLS on storage is
unchanged (backend service-role ops).

## Notifications implemented

Types: `awaiting_approval`, `approved`, `job_added`, `payment`, `overpayment`,
`expense`, `finance_disabled`, plus derived `needs_attention`. Stored in the
`notifications` table; shown in a header bell with unread badge; marking read
is per-item or all. Email delivery is optional, free (existing SMTP config),
and off by default — no Gmail APIs, no paid service.

## How production data/functionality was protected

- Zero destructive operations: no DROP/DELETE/TRUNCATE; every migration step is
  additive and idempotent.
- The migration was **dry-run against the live database in a rolled-back
  transaction** — it validated (83 default jobs backfilled) and left zero
  footprint (verified `to_regclass` = null afterwards).
- Existing endpoints preserved; legacy client-level payment/total/undo now
  route to the default job so old callers can't drift from job-level data.
- Enabling RLS on new tables was verified safe: the app connects as `postgres`
  (owner + `rolbypassrls=true`).
- No secrets in frontend; `SUPABASE_SERVICE_ROLE_KEY` stays server-side.
- Admin enforcement is server-side; frontend gating is cosmetic only.

## Tests performed and results

- `node --check` on every JS file — all pass.
- Server module boot + route inventory — all routers mount correctly.
- **Migration dry-run against the live production DB (rolled back) — PASSED.**
- Full scenario smoke test (`npm run test:smoke`) — written and ready; it
  requires `TEST_DATABASE_URL` (a dedicated test DB) which this environment
  does not have, so it could not be executed here. It covers: no duplicate
  clients, 4 jobs on one client, pre-approval payment rejection, idempotent
  approval, payment/expense math, overpayment (balance 0, credit 2000), tag
  CRUD + filter + case-insensitive duplicate, job-scoped photos, notifications,
  admin adjustment audit, 403 for normal users, notes (client + job), PDFs,
  finance years/summary, logout. Run it with a test DB before deploying.

## Render changes required

No code changes needed. Required env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`, `ADMIN_EMAILS`, and
optionally `EMAIL_NOTIFICATIONS_ENABLED` / `NOTIFICATION_RECIPIENT_EMAIL` —
exact values and the redeploy steps are in MANUAL-STEPS.md. If a Vercel
frontend is used, set `BACKEND_URL` there and add the Vercel origin to Supabase
redirect URLs.

## Safest step-by-step deployment process

1. Run `supabase-migration-v2-jobs-finance.sql` in Supabase SQL Editor (idempotent).
2. Add the Render env vars from MANUAL-STEPS.md.
3. Configure Google Cloud OAuth + Supabase Google provider + redirect URLs
   (MANUAL-STEPS.md §1c/§2).
4. Deploy the backend to Render (`npm install`, `npm start`), watch `/health`.
5. Run `npm run test:smoke` against the **test** database (with
   `TEST_DATABASE_URL` set).
6. Manually verify the checklist in MANUAL-STEPS.md §4 (password login, Google
   login, job flow, tags, approval, overpayment, roles, logout).
7. Redeploy the Vercel frontend if used.
