try {
  // Prefer dotenv when installed.
  require('dotenv').config();
} catch {
  // Fallback .env loader for local dev when dotenv is unavailable.
  const fsFallback = require('fs');
  const pathFallback = require('path');
  const envPath = pathFallback.join(__dirname, '.env');
  if (fsFallback.existsSync(envPath)) {
    const lines = fsFallback.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const equalsIndex = trimmed.indexOf('=');
      if (equalsIndex === -1) continue;
      const key = trimmed.slice(0, equalsIndex).trim();
      const rawValue = trimmed.slice(equalsIndex + 1).trim();
      const unquoted = rawValue.replace(/^['"]|['"]$/g, '');
      if (key && process.env[key] === undefined) {
        process.env[key] = unquoted;
      }
    }
  }
}
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const session = require('express-session');
const multer = require('multer');
const { AppError } = require('./api/request-utils');
const db = require('./api/db');
const { startBackupScheduler } = require('./services/db-backup');

const app = express();
app.set('trust proxy', 1);

// ===== BODY PARSING =====
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// ===== SESSION =====
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const sessionStore = new (require('express-session').MemoryStore)();
const sessionMiddleware = session({
  name: 'devries.sid',
  secret: sessionSecret,
  proxy: true,
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 12
  }
});
app.use(sessionMiddleware);
// Expose the store so the test suite can construct role-scoped sessions.
app.locals.sessionStore = sessionStore;

function isAuthenticated(req) {
  return Boolean(req.session && req.session.authenticated === true);
}

function requirePageAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  return res.redirect('/');
}

function requireApiAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  return res.status(401).json({ success: false, error: 'Unauthorized' });
}

// ===== API REQUEST TIMING =====
app.use('/api', (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[API] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// ===== API AUTH GUARD =====
// Google OAuth session verification and logout are intentionally exempt.
const PUBLIC_API_PATHS = new Set([
  '/auth/google/session',
  '/auth/logout',
  // Supabase URL + anon key only (anon key is safe to expose; it is not a secret).
  '/supabase-config'
]);
app.use('/api', (req, res, next) => {
  if (PUBLIC_API_PATHS.has(req.path)) return next();
  return requireApiAuth(req, res, next);
});

// ===== ACTIVITY LOG (admin "who did what" audit trail) =====
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ACTIVITY_ACTIONS = [
  { pattern: /^\/save-client$/, action: 'Add or update client' },
  { pattern: /^\/delete-client$/, action: 'Delete client' },
  { pattern: /^\/update-project$/, action: 'Update project' },
  { pattern: /^\/clients\/\d+\/jobs$/, action: 'Add job' },
  { pattern: /^\/jobs\/\d+\/payment$/, action: 'Record payment' },
  { pattern: /^\/jobs\/\d+\/reset-paid$/, action: 'Reset payments' },
  { pattern: /^\/jobs\/\d+\/total$/, action: 'Set job total' },
  { pattern: /^\/jobs\/\d+\/finance-state$/, action: 'Restore finance state' },
  { pattern: /^\/jobs\/\d+\/expenses$/, action: 'Record expense' },
  { pattern: /^\/jobs\/\d+\/expenses\/\d+$/, action: 'Delete expense' },
  { pattern: /^\/jobs\/\d+\/tags$/, action: 'Set job tags' },
  { pattern: /^\/jobs\/\d+$/, action: 'Update or delete job' },
  { pattern: /^\/clients\/\d+\/payment$/, action: 'Record client payment' },
  { pattern: /^\/clients\/\d+\/total$/, action: 'Set client total' },
  { pattern: /^\/clients\/\d+\/reset-paid$/, action: 'Reset client payments' },
  { pattern: /^\/clients\/\d+\/finance-state$/, action: 'Restore client finance state' },
  { pattern: /^\/clients\/\d+\/notes/, action: 'Manage client notes' },
  { pattern: /^\/finance\/save$/, action: 'Save finance overrides' },
  { pattern: /^\/finance\/margin\/entries/, action: 'Manage margin entries' },
  { pattern: /^\/notes/, action: 'Manage notes' },
  { pattern: /^\/pdf\/upload/, action: 'Upload file' },
  { pattern: /^\/pdf\/delete/, action: 'Delete file' },
  { pattern: /^\/tags/, action: 'Manage tags' },
  { pattern: /^\/admin\/finance-adjustments$/, action: 'Finance adjustment' },
  { pattern: /^\/admin\/users\/\d+\/role$/, action: 'Change user role' },
  { pattern: /^\/admin/, action: 'Admin action' },
  { pattern: /^\/company-profile/, action: 'Update company profile' },
  { pattern: /^\/email-settings/, action: 'Update email settings' },
  { pattern: /^\/send-invoice/, action: 'Send invoice' },
  { pattern: /^\/send-estimate/, action: 'Send estimate' },
  { pattern: /^\/notifications/, action: 'Update notifications' },
  { pattern: /^\/auth\/logout$/, action: 'Log out' }
];

function activityActionFor(pathname) {
  for (const entry of ACTIVITY_ACTIONS) {
    if (entry.pattern.test(pathname)) return entry.action;
  }
  return null;
}

app.use('/api', (req, res, next) => {
  if (!MUTATING_METHODS.has(req.method)) return next();
  const actor = getSessionUser(req);
  if (!actor) return next();
  const action = activityActionFor(req.path) || `${req.method} ${req.path}`;
  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    db.query(
      `INSERT INTO activity_log (actor_email, actor_name, actor_role, action, method, path, summary)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [actor.email, actor.name || actor.email, actor.role || 'user', action, req.method, req.originalUrl, action]
    ).catch((err) => console.error('[activity] failed to record:', err.message));
  });
  next();
});

const healthRoutes = require('./api/health');

// ===== HEALTH ROUTE =====
app.use('/health', healthRoutes);

// ===== API REQUEST VALIDATION BASELINE =====
app.use('/api', (req, res, next) => {
  const bodyMethods = new Set(['POST', 'PUT', 'PATCH']);
  const hasBodyMethod = bodyMethods.has(req.method);
  if (!hasBodyMethod) return next();

  if (req.is('multipart/form-data')) return next();

  // Bodiless requests (e.g. POST /api/auth/logout) are fine without a body.
  const contentLength = Number(req.headers['content-length'] || 0);
  const hasBody = contentLength > 0 || Boolean(req.headers['transfer-encoding']);
  if (!hasBody) return next();

  if (!req.is('application/json')) {
    return next(new AppError(415, 'Content-Type must be application/json'));
  }
  return next();
});

// ===== API ROUTES =====
const { router: authRoutes, requireRole, getSessionUser } = require('./api/auth');
const clientsRoutes = require('./api/clients');
const { router: jobsRoutes } = require('./api/jobs');
const tagsRoutes = require('./api/tags');
const adminRoutes = require('./api/admin');
const notificationsRoutes = require('./api/notifications');
const companyProfileRoutes = require('./api/company-profile');
const emailSettingsRoutes = require('./api/email-settings');
const invoiceRoutes = require('./api/invoice');
const pdfRoutes = require('./api/pdf');
const notesRoutes = require('./api/notes');
const supabaseConfigRoutes = require('./api/supabase-config');

// Mount routers under /api. The auth router is mounted at '/api/auth' for
// /api/auth/me, /api/auth/google/session, and /api/auth/logout.
app.use('/api/auth', authRoutes);
app.use('/api', clientsRoutes);
app.use('/api', jobsRoutes);
app.use('/api/tags', tagsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/company-profile', companyProfileRoutes);
app.use('/api/email-settings', emailSettingsRoutes);
app.use('/api', invoiceRoutes);
app.use('/api/pdf', pdfRoutes);
app.use('/api/supabase-config', supabaseConfigRoutes);
app.use('/api/notes', notesRoutes);

// Expose role helper for other modules
app.locals.requireRole = requireRole;

// ===== BLOCK SENSITIVE FILES FROM STATIC ACCESS =====
const blockedStaticPaths = [
  /^\/api\//i,
  /^\/node_modules\//i,
  /^\/package(?:-lock)?\.json$/i,
  /^\/server\.js$/i,
  /^\/forge\.config\.js$/i,
  /^\/(?:init-db|update-db)\.js$/i,
  /\.db(?:-wal|-shm)?$/i
];

app.use((req, res, next) => {
  if (blockedStaticPaths.some((pattern) => pattern.test(req.path))) {
    return res.status(404).end();
  }
  return next();
});

// ===== STATIC FILES =====
app.use('/assets', express.static(path.join(__dirname, 'assets'), {
  maxAge: '1d',
  etag: true,
  lastModified: true
}));
app.use(express.static(path.join(__dirname), {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache');
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=3600');
  }
}));

// ===== PAGE ROUTES =====
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/main', (req, res) => {
  if (!isAuthenticated(req)) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'main.html'));
});

app.get('/finance', (req, res) => {
  if (!isAuthenticated(req)) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'finance.html'));
});

app.get('/main.html', requirePageAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'main.html'));
});

app.get('/finance.html', requirePageAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'finance.html'));
});

// ===== API ERROR HANDLER =====
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  if (err instanceof AppError) {
    return res.status(err.status).json({
      success: false,
      error: err.message,
      details: err.details || undefined
    });
  }

  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ success: false, error: 'Invalid JSON body' });
  }

  if (err instanceof multer.MulterError) {
    return res.status(400).json({ success: false, error: err.message });
  }

  console.error('Unhandled server error:', err);
  return res.status(500).json({ success: false, error: 'Internal server error' });
});

// ===== ENSURE UPLOADS FOLDER EXISTS =====
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
console.log('Uploads folder is ready');
if (process.env.ENABLE_DB_BACKUPS === 'true') {
  startBackupScheduler();
}

// ===== START SERVER =====
function startServer(port = process.env.PORT || 3000) {
  const server = app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
