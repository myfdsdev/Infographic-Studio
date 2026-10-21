// Session authentication for browser requests.
//
// Reads the httpOnly session cookie, resolves it to a live session, re-reads
// the user, and rejects suspended accounts on every request (so suspension
// takes effect immediately for sessions that already exist).
//
// "Act as user" (services/actAs.service.js): when an administrator's session
// is acting as a user, req.user is that user and req.impersonator is the
// administrator. Such requests are read-only; only the calls below may write.
import {
  SESSION_COOKIE,
  resolveSession,
  revokeSession,
  clearSessionCookie,
} from '../services/auth.service.js';
import { resolveActingAs } from '../services/actAs.service.js';
import { assertAppAccess } from '../services/platformSettings.service.js';
import { AppError, UnauthorizedError } from '../utils/errors.js';

// Signing out always works, even during maintenance.
const ALWAYS_ALLOWED = new Set(['/api/auth/logout']);

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// The only writes allowed while acting as a user: ending the view, signing out.
const ACT_AS_WRITES = new Set(['/api/auth/act-as/stop', '/api/auth/logout']);

async function attachUser(req, res) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return false;

  const resolved = await resolveSession(token);
  if (!resolved) {
    clearSessionCookie(res);
    throw new UnauthorizedError('Your session has expired. Please sign in again.');
  }

  const { session, user } = resolved;
  if (user.status !== 'active') {
    await revokeSession(session._id, 'suspended');
    clearSessionCookie(res);
    throw new AppError('This account is suspended. Contact the administrator if you think this is a mistake.', {
      statusCode: 403,
      code: 'ACCOUNT_SUSPENDED',
    });
  }

  const path = req.originalUrl.split('?')[0];
  if (!ALWAYS_ALLOWED.has(path)) await assertAppAccess(user);

  const actingAs = await resolveActingAs(session, user, req);
  if (actingAs) {
    if (!READ_METHODS.has(req.method) && !ACT_AS_WRITES.has(path)) {
      throw new AppError(
        'You are viewing the app as this user, so changes are turned off. Exit "Act as user" to make changes.',
        { statusCode: 403, code: 'ACT_AS_READ_ONLY' },
      );
    }
    req.user = actingAs.user;
    req.impersonator = user;
    req.actingAs = actingAs;
  } else {
    req.user = user;
  }
  req.authSession = session;
  return true;
}

/** Require a signed-in, active user. */
export async function authenticate(req, res, next) {
  try {
    const ok = await attachUser(req, res);
    if (!ok) throw new UnauthorizedError('Please sign in to continue.');
    next();
  } catch (error) {
    next(error);
  }
}

/** Attach the user when a valid session exists; continue anonymously otherwise. */
export async function optionalAuthenticate(req, res, next) {
  try {
    await attachUser(req, res);
    next();
  } catch (error) {
    if (error?.statusCode === 401) return next();
    next(error);
  }
}
