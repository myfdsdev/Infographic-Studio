// Audit trail for security-relevant actions. Writing an entry never breaks the
// request that triggered it: failures are logged and swallowed.
import { AuditLog } from '../models/AuditLog.js';
import { logger } from '../config/logger.js';
import { clientIp, escapeRegex, scrubSecrets, userAgentOf } from '../utils/sanitize.js';

function actorFields(actor) {
  if (!actor) return { actorId: null, actorEmail: null, actorRole: null };
  if (typeof actor === 'string') return { actorId: null, actorEmail: actor, actorRole: 'system' };
  return {
    actorId: actor._id || actor.id || null,
    actorEmail: actor.email || null,
    actorRole: actor.role || null,
  };
}

/**
 * @param {object} entry
 * @param {import('express').Request} [entry.req]
 * @param {object|string|null} [entry.actor]  user document, or a label such as "system:bootstrap"
 * @param {string} entry.action               e.g. "auth.login"
 * @param {'auth'|'account'|'admin'|'system'} entry.area
 * @param {'success'|'failure'} [entry.outcome]
 * @param {{type?: string, id?: string, email?: string}} [entry.target]
 * @param {string} [entry.summary]
 * @param {object} [entry.metadata]
 */
export async function recordAudit({ req, actor, action, area, outcome = 'success', target, summary, metadata }) {
  try {
    await AuditLog.create({
      ...actorFields(actor),
      action,
      area,
      outcome,
      targetType: target?.type || null,
      targetId: target?.id ? String(target.id) : null,
      targetEmail: target?.email || null,
      summary: summary ? String(summary).slice(0, 500) : null,
      ip: clientIp(req),
      userAgent: userAgentOf(req),
      metadata: metadata ? scrubSecrets(metadata) : null,
    });
  } catch (error) {
    logger.error({ reason: error.message, action }, 'Failed to write audit log entry');
  }
}

export function toAuditDto(entry) {
  return {
    id: String(entry._id),
    createdAt: entry.createdAt,
    action: entry.action,
    area: entry.area,
    outcome: entry.outcome,
    actorId: entry.actorId ? String(entry.actorId) : null,
    actorEmail: entry.actorEmail,
    actorRole: entry.actorRole,
    targetType: entry.targetType,
    targetId: entry.targetId,
    targetEmail: entry.targetEmail,
    summary: entry.summary,
    ip: entry.ip,
    metadata: entry.metadata,
  };
}

export async function listAuditLogs({ search, area, outcome, targetId, page = 1, limit = 50 } = {}) {
  const clauses = [];
  if (area && area !== 'all') clauses.push({ area });
  if (outcome && outcome !== 'all') clauses.push({ outcome });
  if (targetId) clauses.push({ $or: [{ targetId: String(targetId) }, { actorId: targetId }] });
  if (search) {
    const pattern = new RegExp(escapeRegex(search.slice(0, 100)), 'i');
    clauses.push({ $or: [{ action: pattern }, { actorEmail: pattern }, { targetEmail: pattern }, { summary: pattern }] });
  }
  const filter = clauses.length ? { $and: clauses } : {};

  const safeLimit = Math.min(Math.max(1, limit), 100);
  const skip = (Math.max(1, page) - 1) * safeLimit;
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(safeLimit).lean(),
    AuditLog.countDocuments(filter),
  ]);
  return { items: items.map(toAuditDto), total, page: Math.max(1, page), limit: safeLimit };
}
