// Small helpers for turning untrusted input into safe query values and for
// shaping documents before they leave the API.

export function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

/** Escape a user-supplied string for safe use inside a RegExp. */
export function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isObjectId(value) {
  return typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value);
}

const SECRET_KEY_PATTERN = /pass(word)?|token|secret|api[-_]?key|authorization|cookie|hash/i;

/**
 * Deep-copy plain metadata while dropping anything that looks like a secret.
 * Used before writing audit log entries.
 */
export function scrubSecrets(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => scrubSecrets(item, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(key)) continue;
      out[key] = scrubSecrets(inner, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}...` : value;
  return value;
}

/** The only user fields that are ever sent to the owner of the account. */
export function toPublicUser(user) {
  if (!user) return null;
  return {
    id: String(user._id || user.id),
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null,
    credits: user.credits || 0,
  };
}

/** Fields an administrator sees for any account. */
export function toAdminUser(user) {
  if (!user) return null;
  return {
    ...toPublicUser(user),
    updatedAt: user.updatedAt,
    passwordChangedAt: user.passwordChangedAt || null,
    suspendedAt: user.suspendedAt || null,
    suspendedReason: user.suspendedReason || null,
    suspendedBy: user.suspendedBy ? String(user.suspendedBy) : null,
    googleConnected: Boolean(user.googleId),
    bonusLinkId: user.bonusLinkId ? String(user.bonusLinkId) : null,
  };
}

export function clientIp(req) {
  return req?.ip || req?.socket?.remoteAddress || null;
}

export function userAgentOf(req) {
  const agent = req?.get?.('user-agent') || '';
  return agent.slice(0, 300) || null;
}
