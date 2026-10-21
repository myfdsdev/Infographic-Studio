// Request rate limiting.
//   - general limiter on every /api route (health endpoints exempt)
//   - stricter per-IP limiter on authentication endpoints
//   - per-email limiter on login and password-reset requests, so one account
//     cannot be brute-forced from many IPs
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { TooManyRequestsError } from '../utils/errors.js';
import { normalizeEmail } from '../utils/sanitize.js';

const HEALTH_PATHS = new Set(['/health', '/ready']);

export function createApiLimiter(env) {
  return rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: env.RATE_LIMIT_MAX,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: (req) => HEALTH_PATHS.has(req.path),
    handler: (_req, _res, next) => next(new TooManyRequestsError()),
  });
}

export function createAuthLimiter(env, { skipSuccessfulRequests = false } = {}) {
  return rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: env.AUTH_RATE_LIMIT_MAX,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests,
    handler: (_req, _res, next) =>
      next(new TooManyRequestsError('Too many attempts. Please wait a few minutes and try again.')),
  });
}

export function createEmailLimiter(env, { skipSuccessfulRequests = false } = {}) {
  return rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: env.LOGIN_EMAIL_RATE_LIMIT_MAX,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests,
    keyGenerator: (req) => {
      const email = normalizeEmail(req.body?.email);
      return email ? `email:${email}` : `ip:${ipKeyGenerator(req.ip || '')}`;
    },
    handler: (_req, _res, next) =>
      next(new TooManyRequestsError('Too many attempts for this account. Please wait a few minutes and try again.')),
  });
}
