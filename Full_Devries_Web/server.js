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
const { startBackupScheduler } = require('./services/db-backup');

const app = express();
app.set('trust proxy', 1);

// ===== BODY PARSING =====
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ===== SESSION =====
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
app.use(
  session({
    name: 'devries.sid',
    secret: sessionSecret,
    proxy: true,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 12
    }
  })
);

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
app.use('/api', (req, res, next) => {
  if (req.path === '/login' || req.path === '/change-password') return next();
  return requireApiAuth(req, res, next);
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
  if (!req.is('application/json')) {
    return next(new AppError(415, 'Content-Type must be application/json'));
  }
  return next();
});

// ===== API ROUTES =====
const authRoutes = require('./api/auth');
const clientsRoutes = require('./api/clients');
const pdfRoutes = require('./api/pdf');
const notesRoutes = require('./api/notes');
const supabaseConfigRoutes = require('./api/supabase-config');

// Mount routers under /api
app.use('/api', authRoutes);       // /api/login, /api/change-password
app.use('/api', clientsRoutes);    // /api/clients/...
app.use('/api/pdf', pdfRoutes);    // /api/pdf/*
app.use('/api/supabase-config', supabaseConfigRoutes); // /api/supabase-config
app.use('/api/notes', notesRoutes); // /api/notes/*

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
    if (filePath.endsWith('.html')) {
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
