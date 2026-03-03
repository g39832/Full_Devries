class AppError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.details = details;
  }
}

function asyncHandler(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function assertObject(value, fieldName = 'body') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(400, `Invalid ${fieldName}`);
  }
}

function parseIntField(value, fieldName, { min = null, max = null, required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (!required) return null;
    throw new AppError(400, `${fieldName} is required`);
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new AppError(400, `${fieldName} must be an integer`);
  }
  if (min !== null && parsed < min) {
    throw new AppError(400, `${fieldName} must be at least ${min}`);
  }
  if (max !== null && parsed > max) {
    throw new AppError(400, `${fieldName} must be at most ${max}`);
  }
  return parsed;
}

function parseNumberField(value, fieldName, { min = null, max = null, required = true, defaultValue = null } = {}) {
  if (value === undefined || value === null || value === '') {
    if (!required) return defaultValue;
    throw new AppError(400, `${fieldName} is required`);
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new AppError(400, `${fieldName} must be a number`);
  }
  if (min !== null && parsed < min) {
    throw new AppError(400, `${fieldName} must be at least ${min}`);
  }
  if (max !== null && parsed > max) {
    throw new AppError(400, `${fieldName} must be at most ${max}`);
  }
  return parsed;
}

function parseStringField(value, fieldName, { required = true, trim = true, minLength = 0, maxLength = 5000, defaultValue = '' } = {}) {
  if (value === undefined || value === null) {
    if (!required) return defaultValue;
    throw new AppError(400, `${fieldName} is required`);
  }

  let parsed = String(value);
  if (trim) parsed = parsed.trim();

  if (required && parsed.length < minLength) {
    throw new AppError(400, `${fieldName} is required`);
  }
  if (parsed.length > maxLength) {
    throw new AppError(400, `${fieldName} is too long`);
  }
  return parsed;
}

function parseYear(value, fieldName = 'year') {
  const currentYear = new Date().getFullYear();
  return parseIntField(value, fieldName, { min: 2000, max: currentYear + 5 });
}

module.exports = {
  AppError,
  asyncHandler,
  assertObject,
  parseIntField,
  parseNumberField,
  parseStringField,
  parseYear
};
