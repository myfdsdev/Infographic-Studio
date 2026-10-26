// Authentication, sessions, password reset and self-service account actions.
//
// Security properties enforced here (and covered by tests):
//   - New accounts are always role "user"; roles change only via admin.service
//     or the one-time owner bootstrap script.
//   - Every authenticated request re-reads the user, so suspension or deletion
//     takes effect immediately for existing sessions (and, later, MCP tokens
//     resolved through loadActiveUser()).
//   - Session and reset tokens are random, stored only as HMACs, revocable.
//   - Unknown-email login and password-reset requests are indistinguishable
//     from real ones (generic messages, constant-ish timing).
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { User } from '../models/User.js';
import { Session } from '../models/Session.js';
import { PasswordResetToken } from '../models/PasswordResetToken.js';
import { ApiCredential } from '../models/ApiCredential.js';
import { GenerationJob } from '../models/GenerationJob.js';
import { Infographic } from '../models/Infographic.js';
import { removeAllAssetsOf } from './asset.service.js';
import { revokeAllConnections, deleteAllConnectionsOf } from './mcpConnection.service.js';
import { AppError, NotFoundError, UnauthorizedError } from '../utils/errors.js';
import { hashPassword, verifyPassword, needsRehash, burnPasswordCheck } from '../utils/password.js';
import { generateToken, hashToken, looksLikeToken } from '../utils/tokens.js';
import { clientIp, normalizeEmail, toPublicUser, userAgentOf } from '../utils/sanitize.js';
import { recordAudit } from './audit.service.js';
import { assertSignupAllowed, assertAppAccess } from './platformSettings.service.js';
import { getBranding } from './branding.service.js';
import { claimBonusForNewUser } from './bonusLink.service.js';
import { CreditTransaction } from '../models/CreditTransaction.js';
import { sendEmail, passwordResetEmail } from './email.service.js';

export const SESSION_COOKIE = 'iv_session';
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

// ---- cookies ----------------------------------------------------------------
export function sessionCookieOptions(session) {
  const options = {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.COOKIE_SAMESITE,
    path: '/',
  };
  if (env.COOKIE_DOMAIN) options.domain = env.COOKIE_DOMAIN;
  if (session?.persistent) options.expires = session.expiresAt;
  return options;
}

export function clearSessionCookie(res) {
  const { expires, ...options } = sessionCookieOptions(null); // eslint-disable-line no-unused-vars
  res.clearCookie(SESSION_COOKIE, options);
}

export function setSessionCookie(res, token, session) {
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(session));
}

// ---- errors -----------------------------------------------------------------
const invalidCredentials = () =>
  new AppError('Invalid email or password', { statusCode: 401, code: 'INVALID_CREDENTIALS' });
const suspended = () =>
  new AppError('This account is suspended. Contact the administrator if you think this is a mistake.', {
    statusCode: 403,
    code: 'ACCOUNT_SUSPENDED',
  });

// ---- sessions ---------------------------------------------------------------
export async function createSession(user, { persistent = true, req } = {}) {
  const token = generateToken(32);
  const ttlMs = persistent ? env.SESSION_TTL_DAYS * 24 * 3600 * 1000 : env.SESSION_SHORT_TTL_HOURS * 3600 * 1000;
  const session = await Session.create({
    userId: user._id,
    tokenHash: hashToken(token),
    persistent,
    expiresAt: new Date(Date.now() + ttlMs),
    lastSeenAt: new Date(),
    ip: clientIp(req),
    userAgent: userAgentOf(req),
  });
  return { token, session };
}

/**
 * Resolve a raw session token to { session, user }. Returns null for unknown,
 * expired or revoked sessions. Does NOT check user status; callers decide.
 */
export async function resolveSession(token) {
  if (!looksLikeToken(token)) return null;
  const session = await Session.findOne({
    tokenHash: hashToken(token),
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  });
  if (!session) return null;
  const user = await User.findById(session.userId);
  if (!user) {
    await Session.updateOne({ _id: session._id }, { revokedAt: new Date(), revokedReason: 'user_missing' });
    return null;
  }
  if (Date.now() - new Date(session.lastSeenAt).getTime() > TOUCH_INTERVAL_MS) {
    Session.updateOne({ _id: session._id }, { lastSeenAt: new Date() }).catch((error) =>
      logger.warn({ reason: error.message }, 'Could not update session lastSeenAt'),
    );
  }
  return { session, user };
}

/**
 * Load a user and assert they may act right now. Every auth path (browser
 * sessions today, MCP/OAuth tokens in a later phase) must go through this so
 * suspension blocks access everywhere at once.
 */
export async function loadActiveUser(userId) {
  const user = await User.findById(userId);
  if (!user) throw new UnauthorizedError('Account not found');
  if (user.status !== 'active') throw suspended();
  return user;
}

export async function revokeSession(sessionId, reason = 'logout') {
  await Session.updateOne({ _id: sessionId, revokedAt: null }, { revokedAt: new Date(), revokedReason: reason });
}

export async function revokeAllSessions(userId, { exceptSessionId = null, reason = 'revoked' } = {}) {
  const filter = { userId, revokedAt: null };
  if (exceptSessionId) filter._id = { $ne: exceptSessionId };
  const result = await Session.updateMany(filter, { revokedAt: new Date(), revokedReason: reason });
  return result.modifiedCount || 0;
}

// ---- signup / login / logout -------------------------------------------------
/** Bonus link credits for a new account; a failure never breaks the sign-up. */
export async function grantSignupBonus(user, bonusCode, req) {
  if (!bonusCode) return null;
  try {
    return await claimBonusForNewUser(user, bonusCode, req);
  } catch (error) {
    logger.error({ userId: String(user._id), reason: error.message }, 'Sign-up bonus could not be granted');
    return null;
  }
}

export async function signup({ name, email, password, bonusCode }, req) {
  await assertSignupAllowed();
  const normalized = normalizeEmail(email);
  const passwordHash = await hashPassword(password);
  let user;
  try {
    // Role and status are fixed here on purpose: a public sign-up can never
    // create an administrator, whatever the request body contains.
    user = await User.create({ name, email: normalized, passwordHash, role: 'user', status: 'active' });
  } catch (error) {
    if (error?.code === 11000) {
      throw new AppError('An account with this email already exists. Sign in instead.', {
        statusCode: 409,
        code: 'EMAIL_TAKEN',
      });
    }
    throw error;
  }
  const { token, session } = await createSession(user, { persistent: true, req });
  user.lastLoginAt = new Date();
  await user.save();
  await recordAudit({ req, actor: user, action: 'auth.signup', area: 'auth', target: { type: 'user', id: user._id, email: user.email } });
  const bonus = await grantSignupBonus(user, bonusCode, req);
  if (bonus) user.credits = (user.credits || 0) + bonus.credits;
  return { user, token, session, bonus };
}

export async function login({ email, password, remember = true }, req) {
  const normalized = normalizeEmail(email);
  const user = await User.findOne({ email: normalized }).select('+passwordHash');

  if (!user) {
    await burnPasswordCheck(password);
    await recordAudit({ req, actor: normalized, action: 'auth.login', area: 'auth', outcome: 'failure', summary: 'Unknown email' });
    throw invalidCredentials();
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    await recordAudit({
      req,
      actor: user,
      action: 'auth.login',
      area: 'auth',
      outcome: 'failure',
      target: { type: 'user', id: user._id, email: user.email },
      summary: 'Wrong password',
    });
    throw invalidCredentials();
  }

  if (user.status !== 'active') {
    await recordAudit({
      req,
      actor: user,
      action: 'auth.login',
      area: 'auth',
      outcome: 'failure',
      target: { type: 'user', id: user._id, email: user.email },
      summary: 'Account suspended',
    });
    throw suspended();
  }
  // Maintenance mode: only administrators can sign in.
  await assertAppAccess(user);

  if (needsRehash(user.passwordHash)) user.passwordHash = await hashPassword(password);
  user.lastLoginAt = new Date();
  await user.save();

  const { token, session } = await createSession(user, { persistent: remember !== false, req });
  await recordAudit({ req, actor: user, action: 'auth.login', area: 'auth', target: { type: 'user', id: user._id, email: user.email } });
  return { user, token, session };
}

export async function logout(user, session, req) {
  if (session) await revokeSession(session._id, 'logout');
  if (user) await recordAudit({ req, actor: user, action: 'auth.logout', area: 'auth', target: { type: 'user', id: user._id, email: user.email } });
}

// ---- password reset ------------------------------------------------------------
export async function requestPasswordReset(email, req) {
  const normalized = normalizeEmail(email);
  const user = await User.findOne({ email: normalized });

  // Unknown or suspended accounts get exactly the same response as real ones.
  if (!user || user.status !== 'active') {
    await burnPasswordCheck(normalized);
    await recordAudit({
      req,
      actor: normalized,
      action: 'auth.password_reset_requested',
      area: 'auth',
      outcome: 'failure',
      summary: user ? 'Account suspended; no email sent' : 'Unknown email; no email sent',
    });
    return;
  }

  // Only the newest link works.
  await PasswordResetToken.updateMany({ userId: user._id, usedAt: null }, { usedAt: new Date() });

  const token = generateToken(32);
  await PasswordResetToken.create({
    userId: user._id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60 * 1000),
    requestedIp: clientIp(req),
  });

  const link = `${env.CLIENT_URL.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
  const { appName } = await getBranding();
  const message = passwordResetEmail({ name: user.name, link, minutes: env.PASSWORD_RESET_TTL_MINUTES, appName });
  let delivery = null;
  try {
    delivery = await sendEmail({ to: user.email, ...message });
  } catch (error) {
    logger.error({ reason: error.message, userId: String(user._id) }, 'Password reset email could not be sent');
    await recordAudit({
      req,
      actor: user,
      action: 'auth.password_reset_email_failed',
      area: 'auth',
      outcome: 'failure',
      target: { type: 'user', id: user._id, email: user.email },
      summary: error.message,
    });
    return;
  }
  await recordAudit({
    req,
    actor: user,
    action: 'auth.password_reset_requested',
    area: 'auth',
    target: { type: 'user', id: user._id, email: user.email },
    metadata: { provider: delivery?.provider, delivered: delivery?.delivered },
  });
}

export async function resetPassword({ token, password }, req) {
  const invalid = () =>
    new AppError('This reset link is invalid or has expired. Request a new one.', {
      statusCode: 400,
      code: 'INVALID_RESET_TOKEN',
    });
  if (!looksLikeToken(token)) throw invalid();

  // Claim the token atomically so it can only ever be used once.
  const record = await PasswordResetToken.findOneAndUpdate(
    { tokenHash: hashToken(token), usedAt: null, expiresAt: { $gt: new Date() } },
    { usedAt: new Date() },
    { returnDocument: 'after' },
  );
  if (!record) throw invalid();

  const user = await User.findById(record.userId).select('+passwordHash');
  if (!user || user.status !== 'active') throw invalid();

  user.passwordHash = await hashPassword(password);
  user.passwordChangedAt = new Date();
  await user.save();

  const revoked = await revokeAllSessions(user._id, { reason: 'password_reset' });
  // AI app connections are signed out too (a reset usually means the old password is not trusted).
  const connectionsRevoked = await revokeAllConnections(user._id, 'password_reset');
  await PasswordResetToken.updateMany({ userId: user._id, usedAt: null }, { usedAt: new Date() });
  await recordAudit({
    req,
    actor: user,
    action: 'auth.password_reset_completed',
    area: 'auth',
    target: { type: 'user', id: user._id, email: user.email },
    metadata: { sessionsRevoked: revoked, aiConnectionsRevoked: connectionsRevoked },
  });
}

// ---- self-service account -------------------------------------------------------
export async function updateProfile(user, { name }, req) {
  const before = user.name;
  user.name = name;
  await user.save();
  await recordAudit({
    req,
    actor: user,
    action: 'account.profile_updated',
    area: 'account',
    target: { type: 'user', id: user._id, email: user.email },
    metadata: { nameBefore: before, nameAfter: name },
  });
  return user;
}

export async function changePassword(user, currentSession, { currentPassword, newPassword }, req) {
  const withHash = await User.findById(user._id).select('+passwordHash');
  // An account made with Google has no password yet: the signed-in owner may
  // set the first one. Every later change needs the current password.
  const settingFirst = !withHash?.passwordHash;
  const ok = settingFirst || (await verifyPassword(currentPassword, withHash?.passwordHash));
  if (!ok) {
    await recordAudit({ req, actor: user, action: 'account.password_changed', area: 'account', outcome: 'failure', summary: 'Wrong current password' });
    throw new AppError('Your current password is incorrect', { statusCode: 400, code: 'CURRENT_PASSWORD_INVALID' });
  }
  withHash.passwordHash = await hashPassword(newPassword);
  withHash.passwordChangedAt = new Date();
  await withHash.save();
  const revoked = await revokeAllSessions(user._id, { exceptSessionId: currentSession?._id, reason: 'password_changed' });
  // An AI app connected with the old password must not keep access.
  const connectionsRevoked = await revokeAllConnections(user._id, 'password_changed');
  await recordAudit({
    req,
    actor: user,
    action: settingFirst ? 'account.password_set' : 'account.password_changed',
    area: 'account',
    target: { type: 'user', id: user._id, email: user.email },
    metadata: { otherSessionsRevoked: revoked, aiConnectionsRevoked: connectionsRevoked },
  });
  return { otherSessionsRevoked: revoked, aiConnectionsRevoked: connectionsRevoked };
}

export function toSessionDto(session, currentSessionId) {
  return {
    id: String(session._id),
    current: currentSessionId ? String(session._id) === String(currentSessionId) : false,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    expiresAt: session.expiresAt,
    persistent: session.persistent,
    ip: session.ip,
    userAgent: session.userAgent,
  };
}

/** Only the owner's own, still-valid sessions. */
export async function listSessions(userId, currentSessionId) {
  const sessions = await Session.find({ userId, revokedAt: null, expiresAt: { $gt: new Date() } })
    .sort({ lastSeenAt: -1 })
    .limit(50)
    .lean();
  return sessions.map((session) => toSessionDto(session, currentSessionId));
}

/** Revoke one of the caller's sessions. Another user's session id is a 404. */
export async function revokeOwnSession(user, sessionId, req) {
  const result = await Session.updateOne(
    { _id: sessionId, userId: user._id, revokedAt: null },
    { revokedAt: new Date(), revokedReason: 'user_revoked' },
  );
  if (!result.matchedCount) throw new NotFoundError('Session not found');
  await recordAudit({ req, actor: user, action: 'account.session_revoked', area: 'account', target: { type: 'session', id: sessionId } });
}

export async function revokeOtherSessions(user, currentSession, req) {
  const revoked = await revokeAllSessions(user._id, { exceptSessionId: currentSession?._id, reason: 'user_revoked_others' });
  await recordAudit({ req, actor: user, action: 'account.sessions_revoked', area: 'account', metadata: { revoked } });
  return revoked;
}

export async function deleteAccount(user, { password, confirmEmail }, req) {
  const withHash = await User.findById(user._id).select('+passwordHash');
  if (withHash?.passwordHash) {
    const ok = await verifyPassword(password, withHash.passwordHash);
    if (!ok) throw new AppError('Your password is incorrect', { statusCode: 400, code: 'CURRENT_PASSWORD_INVALID' });
  } else if (normalizeEmail(confirmEmail) !== user.email) {
    // Accounts without a password (made with Google) confirm with their email.
    throw new AppError('Type your account email to confirm.', { statusCode: 400, code: 'CONFIRM_EMAIL_MISMATCH' });
  }

  if (user.role === 'admin') {
    const otherAdmins = await User.countDocuments({ _id: { $ne: user._id }, role: 'admin', status: 'active' });
    if (otherAdmins === 0) {
      throw new AppError('You are the only active administrator. Promote another admin before deleting this account.', {
        statusCode: 409,
        code: 'LAST_ADMIN',
      });
    }
  }

  await Session.deleteMany({ userId: user._id });
  await PasswordResetToken.deleteMany({ userId: user._id });
  // The encrypted provider keys, job history (prompts, results),
  // infographics and stored images belong to the account and go with it. A job already sent to the provider may still finish there; nothing
  // here can call the provider afterwards.
  await ApiCredential.deleteMany({ userId: user._id });
  await GenerationJob.deleteMany({ userId: user._id });
  await Infographic.deleteMany({ userId: user._id });
  await CreditTransaction.deleteMany({ userId: user._id });
  // AI app connections: tokens revoked at once, records removed.
  await deleteAllConnectionsOf(user._id);
  await removeAllAssetsOf(user._id);
  await User.deleteOne({ _id: user._id });
  await recordAudit({
    req,
    actor: { _id: user._id, email: user.email, role: user.role },
    action: 'account.deleted',
    area: 'account',
    target: { type: 'user', id: user._id, email: user.email },
  });
}

export function publicUser(user) {
  return toPublicUser(user);
}

export function assertActive(user) {
  if (!user) throw new UnauthorizedError();
  if (user.status !== 'active') throw suspended();
  return user;
}

