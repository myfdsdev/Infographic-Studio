// Server-side admin authorization. Must run after authenticate().
import { ForbiddenError, UnauthorizedError } from '../utils/errors.js';

export function requireAdmin(req, _res, next) {
  if (!req.user) return next(new UnauthorizedError('Please sign in to continue.'));
  if (req.user.role !== 'admin' || req.user.status !== 'active') {
    return next(new ForbiddenError('Administrator access required.'));
  }
  return next();
}
