// api/authz.js
// Row-level authorization for the app. The backend connects to Postgres as the
// database owner (via DATABASE_URL), so Supabase RLS does NOT apply to these
// queries — authorization must be enforced here in Node.
//
// Model:
//   * Admin              — full access to every client and job, including
//                          financial records (cost, margin, totals, payments).
//   * Restricted/Sales   — can view ALL clients and jobs (read access), and
//                          perform sales functions (notes, tags, status,
//                          scope). Cost / margin data is stripped from their
//                          payloads, and financial mutations are admin-only.
const { getSessionUser } = require('./auth');

const ROLE_ADMIN = 'admin';

function isAdminUser(user) {
  return Boolean(user && user.role === ROLE_ADMIN);
}

function asyncMw(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

async function jobAccessibleBy(user, jobId) {
  // Any authenticated user may view any job. Cost/margin visibility is
  // enforced separately when hydrating the payload (admin-only fields).
  return Boolean(user);
}

async function clientAccessibleBy(user, clientId) {
  // Any authenticated user may view any client.
  return Boolean(user);
}

function requireAdmin(req, res, next) {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ success: false, error: 'Unauthorized' });
  if (!isAdminUser(user)) {
    return res.status(403).json({ success: false, error: 'Forbidden: admin access required' });
  }
  return next();
}

function requireJobAccess() {
  return asyncMw(async (req, res, next) => {
    const user = getSessionUser(req);
    if (!user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    if (isAdminUser(user)) return next();

    const raw = req.params.id ?? req.params.jobId;
    const jobId = Number(raw);
    if (!Number.isInteger(jobId) || jobId < 1) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    if (!(await jobAccessibleBy(user, jobId))) {
      return res.status(403).json({ success: false, error: 'Forbidden: you do not have access to this job' });
    }
    return next();
  });
}

function requireClientAccess() {
  return asyncMw(async (req, res, next) => {
    const user = getSessionUser(req);
    if (!user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    if (isAdminUser(user)) return next();

    // The client id may come from the URL (:clientId/:id) or, on legacy
    // routes like POST /api/update-project, from the request body.
    const raw = req.params.clientId ?? req.params.id ?? req.body?.id;
    const clientId = Number(raw);
    if (!Number.isInteger(clientId) || clientId < 1) {
      // Restricted users can view all clients, so a missing id is not a
      // permission failure — the route itself validates existence.
      return next();
    }
    if (!(await clientAccessibleBy(user, clientId))) {
      return res.status(403).json({ success: false, error: 'Forbidden: you do not have access to this client' });
    }
    return next();
  });
}

// SQL fragment that scopes a client query to the current user (used inside
// routes that build dynamic SQL). Restricted users see ALL clients and jobs,
// so no scoping clause is applied.
function scopedClientClause(user, baseParamIndex) {
  return { clause: '', params: [] };
}

function scopedJobClause(user, baseParamIndex) {
  return { clause: '', params: [] };
}

module.exports = {
  ROLE_ADMIN,
  isAdminUser,
  jobAccessibleBy,
  clientAccessibleBy,
  requireAdmin,
  requireJobAccess,
  requireClientAccess,
  scopedClientClause,
  scopedJobClause
};
