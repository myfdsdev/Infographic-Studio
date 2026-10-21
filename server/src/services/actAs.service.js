// "Act as user": an administrator views the app exactly as one user sees it.
//
// No new sign-in token is issued. The administrator's own session records the
// user for a limited time (Session.actingAs), so signing out ends both, and
// the browser never holds anything that would work without the admin session.
//
// While it is set, middleware/authenticate.js runs every request as that user,
// read-only: the administrator can look at the user's characters, videos and
// settings, but cannot change anything, start a generation or spend the
// user's provider credit. Rules enforced here:
//   - only active administrators, on a browser session;
//   - only active, non-admin accounts, never yourself;
//   - it ends on Exit, after ACT_AS_MINUTES, on sign-out, or as soon as the
//     administrator loses the role or the user is suspended, deleted or made
//     an administrator;
//   - starting and ending are written to the audit log.
import { User } from '../models/User.js';
import { Session } from '../models/Session.js';
import { AppError, ForbiddenError, NotFoundError } from '../utils/errors.js';
import { recordAudit } from './audit.service.js';

export const ACT_AS_MINUTES = 60;

const auditTarget = (user) => ({ type: 'user', id: user._id, email: user.email });

export async function startActingAs(admin, session, targetId, req) {
  if (!session) throw new ForbiddenError('Act as user works only from a signed-in browser.');
  if (String(admin._id) === String(targetId)) {
    throw new AppError('You are already signed in as yourself.', { statusCode: 400, code: 'ACT_AS_SELF' });
  }
  const target = await User.findById(targetId);
  if (!target) throw new NotFoundError('User not found');
  if (target.role === 'admin') {
    throw new AppError('Administrator accounts cannot be viewed this way. Choose a regular user.', {
      statusCode: 403,
      code: 'ACT_AS_ADMIN',
    });
  }
  if (target.status !== 'active') {
    throw new AppError('This account is suspended. Reactivate it first to view the app as this user.', {
      statusCode: 409,
      code: 'ACT_AS_SUSPENDED',
    });
  }

  const startedAt = new Date();
  // Never longer than the administrator's own session.
  const expiresAt = new Date(
    Math.min(startedAt.getTime() + ACT_AS_MINUTES * 60 * 1000, new Date(session.expiresAt).getTime()),
  );
  const result = await Session.updateOne(
    { _id: session._id, revokedAt: null },
    { actingAs: { userId: target._id, startedAt, expiresAt } },
  );
  if (!result.matchedCount) throw new ForbiddenError('Your session has ended. Sign in again.');

  await recordAudit({
    req,
    actor: admin,
    action: 'admin.act_as_started',
    area: 'admin',
    target: auditTarget(target),
    summary: `Viewing the app as this user, read-only, for up to ${ACT_AS_MINUTES} minutes`,
  });
  return { user: target, startedAt, expiresAt };
}

/** End "act as" on this session. `target` may be null when the user no longer exists. */
export async function stopActingAs(admin, session, target, req, reason = 'Exited') {
  await Session.updateOne({ _id: session._id }, { actingAs: null });
  await recordAudit({
    req,
    actor: admin,
    action: 'admin.act_as_ended',
    area: 'admin',
    target: target ? auditTarget(target) : { type: 'user', id: session.actingAs?.userId },
    summary: reason,
  });
}

/**
 * For a session owned by an active user: the user it is acting as, or null.
 * Ends the view (without touching the administrator's session) when it has
 * expired or is no longer allowed.
 */
export async function resolveActingAs(session, owner, req) {
  const actingAs = session.actingAs;
  if (!actingAs?.userId) return null;

  const target = await User.findById(actingAs.userId);
  let reason = null;
  if (owner.role !== 'admin') reason = 'Ended: the administrator role was removed';
  else if (new Date(actingAs.expiresAt).getTime() <= Date.now()) reason = `Ended after ${ACT_AS_MINUTES} minutes`;
  else if (!target) reason = 'Ended: the account no longer exists';
  else if (target.status !== 'active') reason = 'Ended: the account was suspended';
  else if (target.role === 'admin') reason = 'Ended: the account became an administrator';

  if (reason) {
    await stopActingAs(owner, session, target, req, reason);
    session.actingAs = null;
    return null;
  }
  return { user: target, startedAt: actingAs.startedAt, expiresAt: actingAs.expiresAt };
}

/** What the browser is told about an active "act as" view. */
export function toActingAsDto(admin, actingAs) {
  if (!admin || !actingAs) return null;
  return {
    admin: { id: String(admin._id), name: admin.name, email: admin.email },
    startedAt: actingAs.startedAt,
    expiresAt: actingAs.expiresAt,
  };
}
