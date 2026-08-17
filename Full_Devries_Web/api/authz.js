// api/authz.js
// Row-level authorization for the app. The backend connects to Postgres as the
// database owner (via DATABASE_URL), so Supabase RLS does NOT apply to these
// queries — authorization must be enforced here in Node.
//
// Model:
//   * Admin              — full access to every client and job.
//   * Restricted/Sales   — only clients that own a job assigned to them
//                          (jobs.sales_user_id = their app_users.id).
const db = require('./db');
const { getSessionUser } = require('./auth');

const ROLE_ADMIN = 'admin';

function isAdminUser(user) {
  return Boolean(user && user.role === ROLE_ADMIN);
}

function asyncMw(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

async function jobAccessibleBy(user, jobId) {
  if (isAdminUser(user)) return true;
  if (!user) return false;
  await db.schemaReady;
  const { rows } = await db.query('SELECT sales_user_id FROM jobs WHERE id = $1', [jobId]);
  if (!rows[0]) return false;
  return rows[0].sales_user_id != null && Number(rows[0].sales_user_id) === Number(user.id);
}

async function clientAccessibleBy(user, clientId) {
  if (isAdminUser(user)) return true;
  if (!user) return false;
  await db.schemaReady;
  const { rows } = await db.query(
    'SELECT 1 FROM jobs WHERE client_id = $1 AND sales_user_id = $2 LIMIT 1',
    [clientId, user.id]
  );
  return rows.length > 0;
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

    const raw = req.params.clientId ?? req.params.id;
    const clientId = Number(raw);
    if (!Number.isInteger(clientId) || clientId < 1) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    if (!(await clientAccessibleBy(user, clientId))) {
      return res.status(403).json({ success: false, error: 'Forbidden: you do not have access to this client' });
    }
    return next();
  });
}

// SQL fragment that scopes a client query to the current user (used inside
// routes that build dynamic SQL). Returns { clause, params } where clause is
// an already-parameterized fragment ("AND ... $1" style handled by caller).
function scopedClientClause(user, baseParamIndex) {
  if (isAdminUser(user)) return { clause: '', params: [] };
  return {
    clause: ` AND EXISTS (
      SELECT 1 FROM jobs jj WHERE jj.client_id = clients.id AND jj.sales_user_id = $${baseParamIndex}
    )`,
    params: [Number(user.id)]
  };
}

function scopedJobClause(user, baseParamIndex) {
  if (isAdminUser(user)) return { clause: '', params: [] };
  return {
    clause: ` AND jobs.sales_user_id = $${baseParamIndex}`,
    params: [Number(user.id)]
  };
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
