# MANUAL STEPS I NEED TO DO

These are the exact steps **you** must do. Nothing here was done automatically —
Google login, Supabase Auth, and Render env vars can only be configured by an
account owner, and I never touch production infra without you.

> ⏳ **Google login will NOT work until all three sections (Google Cloud,
> Supabase, Render) are completed.** The button shows a clear "not configured"
> message until then. Login is now Google-only — until this is set up, nobody
> can sign in.

---

## 1. Supabase (database, Auth, Storage)

### 1a. Run the database migration (do this FIRST)

1. Open your Supabase project → **SQL Editor** → **New query**.
2. Copy the entire contents of `supabase-migration-v2-jobs-finance.sql`.
3. Paste and click **Run**.
4. You should see "Success". It is safe to run again (idempotent).
   - Creates: `jobs`, `tags`, `job_tags`, `app_users`, `finance_adjustments`,
     `notifications`; adds `job_id` to `payments`, `notes`,
     `finance_margin_entries`; creates one default Job per existing client and
     backfills every existing payment/note to its Job.
   - **Nothing is dropped or deleted.** If you ever need to undo it, the
     rollback SQL is commented at the bottom of that file.
5. Also run `supabase-migration-v3-workspaces.sql` (additive): adds
   `jobs.sales_user_id` (sales-person assignment), `tags.kind` + client primary
   tag, `job_line_items` (job-scoped estimates/invoices), note authors, and
   per-user notifications. The app applies the same schema automatically on
   boot, so this is optional but recommended for an auditable record.

Optional but recommended: run the *read-only* verification scripts against your
**test** database:
```bash
node scripts/inspect-schema.js
ALLOW_PRODUCTION_AUDIT=true node scripts/inspect-data-counts.js   # counts only, no row contents
```

### 1b. Storage bucket (already used by the app)

- The app already uploads to a bucket (default `client-files`; configurable via
  `SUPABASE_STORAGE_BUCKET`). The backend creates it automatically on first use
  (non-public). No action needed unless you disabled auto-create.
- **Do not** create the bucket as public — signed URLs are used for access.
- Job photos are stored under `job-<jobId>/...` keys; old client photos stay
  under `<clientId>/...` and remain reachable through each client's default job
  (`legacy_storage_key`).

### 1c. Enable the Google provider (Supabase Auth)

1. Supabase → **Authentication** → **Providers**.
2. Find **Google** and click the pencil / toggle it on.
3. You need a Google Cloud OAuth **Client ID** and **Client Secret** (created in
   section 2 below). Paste them in.
4. Save. Supabase then exposes the OAuth redirect URL you must register in
   Google Cloud: it looks like
   `https://<your-project-ref>.supabase.co/auth/v1/callback`.

### 1d. Redirect URLs (Supabase Auth)

1. Supabase → **Authentication** → **URL Configuration**.
2. **Site URL:** `https://<your-render-app>.onrender.com` (your backend origin).
3. **Redirect URLs** — add **both**:
   - `https://<your-render-app>.onrender.com/auth-callback.html`
   - `http://localhost:3000/auth-callback.html` (local testing)
   If your frontend is on Vercel, also add the Vercel origin, e.g.
   `https://<your-vercel-app>.vercel.app/auth-callback.html`.

### 1e. RLS (already applied by the migration)

The migration enables Row Level Security on all new tables with **no policies**,
so the anon/authenticated keys cannot read or write them. The app's backend
connects as the `postgres` role (table owner, `BYPASSRLS`), which is unaffected.
If you ever expose tables to Supabase Auth directly, add explicit policies —
never blanket `authenticated` access.

---

## 2. Google Cloud (OAuth client for Supabase)

1. Go to https://console.cloud.google.com/ → select (or create) the project.
2. **APIs & Services** → **OAuth consent screen**:
   - User type: **External** (Internal is fine if you use Google Workspace).
   - Fill in app name (e.g. "DeVries Roofing CRM"), support email.
   - **Scopes:** keep the defaults (`email`, `profile`, `openid`). Do **not**
     add Gmail/Drive scopes — the app only needs sign-in identity. (Email
     notifications, if you enable them later, use SMTP — not Gmail APIs.)
   - Test users: while in "Testing" mode, add every Google account that should
     log in. Publish the app when ready (production).
3. **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth
   client ID**:
   - Application type: **Web application**.
   - Name: `DeVries CRM - Supabase Auth`.
   - **Authorized JavaScript origins:** (any of your origins; Supabase handles
     the consent)
     - `https://<your-render-app>.onrender.com`
     - `https://<your-vercel-app>.vercel.app` (if you have one)
     - `http://localhost:3000` (local testing)
   - **Authorized redirect URIs:** add exactly:
     - `https://<your-project-ref>.supabase.co/auth/v1/callback`
     - `https://<your-render-app>.onrender.com/auth-callback.html`
     - `http://localhost:3000/auth-callback.html`
   - The **critical** one is the Supabase callback URL
     `https://<ref>.supabase.co/auth/v1/callback` — Google will reject the flow
     without it.
4. Click **Create**. Copy the **Client ID** and **Client Secret** → paste them
   into Supabase → Authentication → Providers → Google (section 1c). Save.
5. (Optional) if you later enable email notifications via SMTP, you only need an
   app password in Google Account → Security → 2-Step Verification → App
   passwords — no OAuth consent screen changes.

---

## 3. Render (backend host)

### 3a. Environment variables

In your Render service → **Environment** → **Environment Variables**, set:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Your Supabase postgres connection string (Settings → Database → Connection string → **URI**, with `sslmode=require`) — already set |
| `SESSION_SECRET` | Long random string (already set — keep it) |
| `SUPABASE_URL` | `https://<your-project-ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | Your project's **anon / publishable** key (safe to expose; it is not a secret) |
| `SUPABASE_SERVICE_ROLE_KEY` | Your project's **service_role** key (secret — never expose to the frontend; used server-side for storage) |
| `SUPABASE_STORAGE_BUCKET` | `client-files` (or your bucket name) |
| `STORAGE_BACKEND` | `auto` (default; set `local` only to disable cloud storage) |
| `NODE_ENV` | `production` |
| `ADMIN_EMAILS` | Comma-separated Google emails that should be **admins**, e.g. `grayson@devries.com,office@devries.com`. Only these emails are admins on login — there is **no** automatic first-login admin. Admins can also promote/demote other users in Settings → Users. |
| `EMAIL_NOTIFICATIONS_ENABLED` | `false` (leave off unless you set up SMTP below) |
| `NOTIFICATION_RECIPIENT_EMAIL` | Optional — email address to receive notification emails (requires SMTP settings configured in the app's Email Setup modal) |
| `ENABLE_DB_BACKUPS` | `true` (backups land on the Render disk) |

**Never** put `SUPABASE_SERVICE_ROLE_KEY` or `SESSION_SECRET` in the frontend.

### 3b. Deploy / redeploy

1. Commit and push the changes to your repo (branch `main`).
2. Render (Blueprints or your web service) — confirm:
   - **Build command:** `npm install` (default).
   - **Start command:** `npm start` (runs `node server.js`).
3. Deploy. Watch logs for `Server running on ...` and `Database backup scheduler
   enabled` (if backups on).
4. Verify: `https://<your-render-app>.onrender.com/health` returns `{"status":"ok"}`.

> **Vercel note:** if your frontend is deployed on Vercel, `vercel.json`
> rewrites `/api/*` to `${BACKEND_URL}/api/*` — set the `BACKEND_URL` env var in
> Vercel to your Render host (no `https://`), and redeploy Vercel. The Supabase
> **Site URL / Redirect URLs** in section 1d must then include the Vercel
> origin too.

---

## 4. Post-deploy verification checklist

1. The login page shows only "Continue with Google" (no password field).
2. Log in with Google ("Continue with Google") → lands on `/main`.
3. Open an existing client → it has one job (its old data). Add a second job —
   no duplicate client appears.
4. Approve a job → finance unlocks; approve again → no duplicate records.
5. Click a tag → jobs filter. Settings → Tags → add/rename/remove (admin).
6. Record a payment larger than the amount due → Balance Due $0 and
   Overpayment/Credit shown (never a negative number).
7. As a normal user: Settings shows no admin controls, and direct calls to
   `/api/admin/*` return 403.
8. Log out → `/main` redirects to login.

## 5. Rollback / safety

- The migration is additive; to undo it, run the commented rollback block at the
  bottom of `supabase-migration-v2-jobs-finance.sql` **while the app is
  stopped**. Original data (payments/notes/margin entries via `client_id`) is
  untouched.
- Old client-level payments/totals/undo endpoints still exist and now operate on
  the client's default job, so any old UI/API callers keep working.
