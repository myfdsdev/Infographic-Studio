// Central 404 and error handling. Express 5 forwards rejected promises from
// async handlers here automatically, so controllers can simply `throw`.
import { AppError, NotFoundError } from '../utils/errors.js';

// 503s an administrator switched on deliberately (Admin > Access). They are
// logged as warnings so the operations log's errors stay real failures.
const ADMIN_PAUSE_CODES = new Set(['GENERATION_PAUSED', 'MAINTENANCE', 'MCP_DISABLED']);

/** True when this response is an intentional admin pause (set by errorHandler). */
export function isAdminPauseResponse(res) {
  return res.locals?.adminPause === true;
}

export function notFoundHandler(req, _res, next) {
  next(new NotFoundError(`Route ${req.method} ${req.originalUrl} not found`));
}

function normalize(err) {
  if (err instanceof AppError) {
    return { statusCode: err.statusCode, code: err.code, message: err.message, details: err.details };
  }
  // Body parser rejected the payload (malformed JSON, too large, ...).
  if (err?.type === 'entity.parse.failed') {
    return { statusCode: 400, code: 'INVALID_JSON', message: 'Request body is not valid JSON' };
  }
  if (err?.type === 'entity.too.large') {
    return { statusCode: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' };
  }
  // CORS rejection raised by the cors middleware.
  if (err?.code === 'CORS_NOT_ALLOWED') {
    return { statusCode: 403, code: 'CORS_NOT_ALLOWED', message: err.message };
  }
  // Mongoose validation / cast errors surface as 400s.
  if (err?.name === 'ValidationError' && err.errors) {
    const details = Object.fromEntries(
      Object.entries(err.errors).map(([key, value]) => [key, value.message]),
    );
    return { statusCode: 400, code: 'VALIDATION_ERROR', message: 'Validation failed', details };
  }
  if (err?.name === 'CastError') {
    return { statusCode: 400, code: 'INVALID_ID', message: `Invalid value for ${err.path}` };
  }
  if (err?.code === 11000) {
    return { statusCode: 409, code: 'DUPLICATE', message: 'A record with the same unique value already exists' };
  }
  const statusCode = Number.isInteger(err?.status)
    ? err.status
    : Number.isInteger(err?.statusCode)
      ? err.statusCode
      : 500;
  return {
    statusCode,
    code: statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR',
    message: statusCode >= 500 ? 'Something went wrong on our side' : err?.message || 'Request failed',
  };
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  const { statusCode, code, message, details } = normalize(err);
  const log = req.log || console;
  const isProduction = process.env.NODE_ENV === 'production';

  if (ADMIN_PAUSE_CODES.has(code)) {
    res.locals.adminPause = true;
    log.warn({ code, statusCode, requestId: req.id }, 'Request refused: paused by an administrator');
  } else if (statusCode >= 500) {
    log.error({ err, requestId: req.id }, 'Unhandled error');
  } else {
    log.warn({ code, statusCode, requestId: req.id, reason: err?.message }, 'Request error');
  }

  if (res.headersSent) return;

  res.status(statusCode).json({
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
      ...(req.id ? { requestId: req.id } : {}),
      ...(!isProduction && statusCode >= 500 && err?.stack
        ? { stack: err.stack.split('\n').slice(0, 8) }
        : {}),
    },
  });
}
