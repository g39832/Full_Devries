function toBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false;
  }
  return fallback;
}

function normalizeEmailConfig(raw = {}, env = process.env) {
  const provider = String(raw.provider || env.EMAIL_PROVIDER || 'gmail').trim().toLowerCase();
  const defaults = provider === 'outlook'
    ? { smtpHost: 'smtp.office365.com', smtpPort: 587, smtpSecure: false }
    : provider === 'gmail'
      ? { smtpHost: 'smtp.gmail.com', smtpPort: 587, smtpSecure: false }
      : { smtpHost: '', smtpPort: 587, smtpSecure: false };

  const smtpUser = String(raw.smtpUser || raw.fromEmail || env.EMAIL_USER || '').trim();
  const smtpPassword = raw.smtpPassword ?? env.EMAIL_PASS ?? '';
  const smtpHost = String(raw.smtpHost || defaults.smtpHost || '').trim();
  const smtpPort = Number(raw.smtpPort ?? defaults.smtpPort ?? 587);
  const smtpSecure = toBoolean(raw.smtpSecure, defaults.smtpSecure);
  const fromName = String(raw.fromName || env.BUSINESS_NAME || 'Your Company Name').trim();
  const fromEmail = String(raw.fromEmail || smtpUser || env.EMAIL_USER || env.BUSINESS_EMAIL || '').trim();
  const replyToEmail = String(raw.replyToEmail || fromEmail || '').trim();

  return {
    provider,
    smtpHost,
    smtpPort: Number.isFinite(smtpPort) && smtpPort > 0 ? smtpPort : defaults.smtpPort,
    smtpSecure,
    smtpUser,
    smtpPassword: String(smtpPassword || ''),
    fromName,
    fromEmail,
    replyToEmail
  };
}

function maskEmailConfig(config = {}) {
  const normalized = normalizeEmailConfig(config);
  return {
    provider: normalized.provider,
    smtpHost: normalized.smtpHost,
    smtpPort: normalized.smtpPort,
    smtpSecure: normalized.smtpSecure,
    smtpUser: normalized.smtpUser,
    fromName: normalized.fromName,
    fromEmail: normalized.fromEmail,
    replyToEmail: normalized.replyToEmail,
    hasPassword: Boolean(normalized.smtpPassword)
  };
}

function buildTransportOptions(config = {}) {
  const normalized = normalizeEmailConfig(config);

  if (!normalized.smtpUser) {
    throw new Error('Email sender username is not configured');
  }

  if (!normalized.smtpPassword) {
    throw new Error('Email sender password is not configured');
  }

  if (!normalized.smtpHost && normalized.provider === 'gmail') {
    return {
      service: 'gmail',
      auth: {
        user: normalized.smtpUser,
        pass: normalized.smtpPassword
      }
    };
  }

  if (!normalized.smtpHost) {
    throw new Error('SMTP host is required for email sending');
  }

  return {
    host: normalized.smtpHost,
    port: normalized.smtpPort || 587,
    secure: Boolean(normalized.smtpSecure),
    auth: {
      user: normalized.smtpUser,
      pass: normalized.smtpPassword
    }
  };
}

function formatFromAddress(config = {}) {
  const normalized = normalizeEmailConfig(config);
  const email = normalized.fromEmail || normalized.smtpUser;
  if (!email) return '';
  if (!normalized.fromName) return email;
  return `${normalized.fromName} <${email}>`;
}

module.exports = {
  buildTransportOptions,
  formatFromAddress,
  maskEmailConfig,
  normalizeEmailConfig
};
