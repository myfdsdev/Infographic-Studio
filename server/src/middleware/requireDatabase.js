// Fail fast with 503 instead of letting Mongoose buffer a query until it times
// out when the database is not connected.
import { isDatabaseConnected } from '../config/database.js';
import { AppError } from '../utils/errors.js';

export function requireDatabase(_req, _res, next) {
  if (isDatabaseConnected()) return next();
  return next(
    new AppError('The database is not connected. Try again shortly.', {
      statusCode: 503,
      code: 'DATABASE_UNAVAILABLE',
    }),
  );
}
