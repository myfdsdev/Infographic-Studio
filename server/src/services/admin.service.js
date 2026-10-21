// Administrator operations on accounts. Route-level middleware already ensures
// the caller is an active admin; this service enforces the business rules
// (no self-demotion, never zero active admins, suspension revokes access).
import { User } from '../models/User.js';
import { Session } from '../models/Session.js';
import { PasswordResetToken } from '../models/PasswordResetToken.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import { escapeRegex, toAdminUser } from '../utils/sanitize.js';
import { recordAudit, listAuditLogs } from './audit.service.js';
import { revokeAllSessions } from './auth.service.js';
import { listCredentialsForAdmin } from './credential.service.js';
import { connectionsOfUser, usageOfUser } from './adminOps.service.js';

export async function listUsers({ search, status, role, page = 1, limit = 25 } = {}) {
  const filter = {};
  if (status && status !== 'all') filter.status = status;
  if (role && role !== 'all') filter.role = role;
  if (search) {
    const pattern = new RegExp(escapeRegex(search.trim().slice(0, 100)), 'i');
    filter.$or = [{ email: pattern }, { name: pattern }];
  }
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const safePage = Math.max(1, page);
  const [items, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    User.countDocuments(filter),
  ]);
  return { items: items.map(toAdminUser), total, page: safePage, limit: safeLimit };
}

export async function getUserDetails(id) {
  const user = await User.findById(id).lean();
  if (!user) throw new NotFoundError('User not found');
  const [activeSessions, activity, credentials, mcpConnections, usage] = await Promise.all([
    Session.countDocuments({ userId: user._id, revokedAt: null, expiresAt: { $gt: new Date() } }),
    listAuditLogs({ targetId: String(user._id), limit: 25 }),
    // Provider and status only: administrators never see keys or key digits.
    listCredentialsForAdmin(user._id),
    connectionsOfUser(user._id),
    usageOfUser(user._id),
  ]);
  return { user: toAdminUser(user), activeSessions, recentActivity: activity.items, credentials, mcpConnections, usage };
}

async function otherActiveAdmins(excludeId) {
  return User.countDocuments({ _id: { $ne: excludeId }, role: 'admin', status: 'active' });
}

/**
 * Change a user's role and/or status.
 * @param {object} actor  the authenticated admin (req.user)
 */
export async function updateUser(actor, id, { role, status, reason }, req) {
  if (String(actor._id) === String(id)) {
    throw new AppError('You cannot change your own role or status. Ask another administrator.', {
      statusCode: 400,
      code: 'SELF_MODIFICATION',
    });
  }

  const user = await User.findById(id);
  if (!user) throw new NotFoundError('User not found');

  const losingAdmin =
    user.role === 'admin' && user.status === 'active' && ((role && role !== 'admin') || status === 'suspended');
  if (losingAdmin && (await otherActiveAdmins(user._id)) === 0) {
    throw new AppError('This would leave no active administrator.', { statusCode: 409, code: 'LAST_ADMIN' });
  }

  const changes = [];

  if (role && role !== user.role) {
    const from = user.role;
    user.role = role;
    changes.push({ action: 'admin.user_role_changed', summary: `Role ${from} -> ${role}`, metadata: { from, to: role } });
  }

  let revoked = 0;
  if (status && status !== user.status) {
    if (status === 'suspended') {
      user.status = 'suspended';
      user.suspendedAt = new Date();
      user.suspendedReason = reason ? String(reason).slice(0, 500) : null;
      user.suspendedBy = actor._id;
      changes.push({
        action: 'admin.user_suspended',
        summary: reason ? `Suspended: ${String(reason).slice(0, 200)}` : 'Suspended',
        metadata: { reason: reason || null },
      });
    } else {
      user.status = 'active';
      user.suspendedAt = null;
      user.suspendedReason = null;
      user.suspendedBy = null;
      changes.push({ action: 'admin.user_reactivated', summary: 'Reactivated', metadata: { reason: reason || null } });
    }
  }

  if (changes.length === 0) return { user: toAdminUser(user), changed: false };

  await user.save();

  if (user.status === 'suspended') {
    // Existing browser sessions stop working immediately; outstanding reset
    // links are voided. (Every request also re-checks status, which is what
    // blocks MCP tokens once that phase ships.)
    revoked = await revokeAllSessions(user._id, { reason: 'suspended' });
    await PasswordResetToken.updateMany({ userId: user._id, usedAt: null }, { usedAt: new Date() });
  }

  for (const change of changes) {
    await recordAudit({
      req,
      actor,
      action: change.action,
      area: 'admin',
      target: { type: 'user', id: user._id, email: user.email },
      summary: change.summary,
      metadata: { ...change.metadata, ...(change.action === 'admin.user_suspended' ? { sessionsRevoked: revoked } : {}) },
    });
  }

  return { user: toAdminUser(user), changed: true, sessionsRevoked: revoked };
}

export { listAuditLogs };
