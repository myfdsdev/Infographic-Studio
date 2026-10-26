// Administrator views of the running system: statistics, health, failures,
// operational logs, AI connections across all users and the provider model
// catalogue. Nothing here returns provider keys, prompts or tokens; free-text
// errors are passed through redactText before they leave the server.
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { Session } from '../models/Session.js';
import { GenerationJob } from '../models/GenerationJob.js';
import { Infographic } from '../models/Infographic.js';
import { Asset } from '../models/Asset.js';
import { ApiCredential } from '../models/ApiCredential.js';
import { McpConnection } from '../models/McpConnection.js';
import { AuditLog } from '../models/AuditLog.js';
import { OpsLog, OPS_LEVELS } from '../models/OpsLog.js';
import { KIE_MODELS } from '../providers/kie/capabilities.js';
import { INFOGRAPHIC_MODEL, infographicStats, countInfographicsOf, toAdminInfographicDto } from './infographic.service.js';
import { getPlatformSettings, setModelEnabled } from './platformSettings.service.js';
import { toConnectionDto } from './mcpConnection.service.js';
import { revokeGrantArtifacts } from '../mcp/oauthStore.js';
import { getEmailStatus } from './email.service.js';
import { recordAudit } from './audit.service.js';
import { redactText } from '../utils/redact.js';
import { escapeRegex, isObjectId } from '../utils/sanitize.js';
import { NotFoundError } from '../utils/errors.js';

const DAY = 24 * 60 * 60 * 1000;

function since(ms) {
  return new Date(Date.now() - ms);
}

async function countBy(model, field, match = {}) {
  const rows = await model.aggregate([{ $match: match }, { $group: { _id: `$${field}`, count: { $sum: 1 } } }]);
  return Object.fromEntries(rows.map((row) => [row._id || 'unknown', row.count]));
}

// ---------------------------------------------------------------- statistics

export async function getStats() {
  const day = since(DAY);
  const week = since(7 * DAY);
  const [
    totalUsers,
    activeUsers,
    suspendedUsers,
    admins,
    newUsers7d,
    activeSessions,
    jobsByStatus,
    jobsCreated24h,
    jobsFailed24h,
    jobsCompleted24h,
    infographics,
    usersWithKey,
    invalidKeys,
    activeConnections,
    toolCalls24h,
    toolFailures24h,
    storage,
    opsErrors24h,
  ] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ status: 'active' }),
    User.countDocuments({ status: 'suspended' }),
    User.countDocuments({ role: 'admin' }),
    User.countDocuments({ createdAt: { $gte: week } }),
    Session.countDocuments({ revokedAt: null, expiresAt: { $gt: new Date() } }),
    countBy(GenerationJob, 'status'),
    GenerationJob.countDocuments({ createdAt: { $gte: day } }),
    GenerationJob.countDocuments({ status: 'failed', completedAt: { $gte: day } }),
    GenerationJob.countDocuments({ status: 'completed', completedAt: { $gte: day } }),
    infographicStats(),
    ApiCredential.distinct('userId').then((ids) => ids.length),
    ApiCredential.countDocuments({ status: 'invalid' }),
    McpConnection.countDocuments({ status: 'active' }),
    AuditLog.countDocuments({ area: 'mcp', action: /^mcp\.tool\./, createdAt: { $gte: day } }),
    AuditLog.countDocuments({ area: 'mcp', action: /^mcp\.tool\./, outcome: 'failure', createdAt: { $gte: day } }),
    Asset.aggregate([{ $group: { _id: null, files: { $sum: 1 }, bytes: { $sum: '$size' } } }]),
    OpsLog.countDocuments({ level: { $in: ['error', 'fatal'] }, at: { $gte: day } }),
  ]);
  return {
    // Kept for the header tiles.
    totalUsers,
    activeUsers,
    suspendedUsers,
    admins,
    activeSessions,
    users: { total: totalUsers, active: activeUsers, suspended: suspendedUsers, admins, new7d: newUsers7d, withProviderKey: usersWithKey },
    jobs: {
      queued: jobsByStatus.queued || 0,
      processing: jobsByStatus.processing || 0,
      completed: jobsByStatus.completed || 0,
      failed: jobsByStatus.failed || 0,
      cancelled: jobsByStatus.cancelled || 0,
      created24h: jobsCreated24h,
      failed24h: jobsFailed24h,
      completed24h: jobsCompleted24h,
    },
    infographics,
    keys: { usersWithKey, invalid: invalidKeys },
    mcp: { activeConnections, toolCalls24h, toolFailures24h },
    storage: { files: storage[0]?.files || 0, bytes: storage[0]?.bytes || 0 },
    ops: { errors24h: opsErrors24h },
  };
}

// ---------------------------------------------------------------- health

export async function systemHealth() {
  const now = new Date();
  const [settings, dueNow, oldestDue, activeInfographics] = await Promise.all([
    getPlatformSettings(),
    GenerationJob.countDocuments({ status: { $in: ['queued', 'processing'] }, nextRunAt: { $lte: now }, $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }] }),
    GenerationJob.findOne({ status: 'queued', nextRunAt: { $lte: now } }).sort({ nextRunAt: 1 }).select('nextRunAt').lean(),
    Infographic.countDocuments({ status: { $in: ['queued', 'processing'] } }),
  ]);
  const email = getEmailStatus();
  return {
    database: { connected: mongoose.connection.readyState === 1, name: env.databaseName },
    worker: {
      enabledInThisProcess: env.WORKER_ENABLED,
      workerConcurrency: settings.limits.workerConcurrency,
      userConcurrency: settings.limits.userConcurrency,
      dueNow,
      oldestDueSeconds: oldestDue ? Math.max(0, Math.round((now - oldestDue.nextRunAt) / 1000)) : 0,
      infographicsActive: activeInfographics,
    },
    storage: { driver: env.STORAGE_DRIVER, sharedBucketPrefix: env.STORAGE_ALLOW_SHARED_BUCKET ? env.STORAGE_KEY_PREFIX : null },
    email: { provider: email.provider, deliversToInbox: Boolean(email.deliversToInbox) },
    mcp: { enabled: env.MCP_ENABLED && settings.access.mcpEnabled, url: env.mcpResourceUrl },
    access: settings.access,
    process: { uptimeSeconds: Math.round(process.uptime()), node: process.version, memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024) },
  };
}

// ---------------------------------------------------------------- failures

export async function failureSummary({ days = 7 } = {}) {
  const from = since(Math.min(Math.max(1, days), 30) * DAY);
  const [jobGroups, recentJobs] = await Promise.all([
    GenerationJob.aggregate([
      { $match: { status: 'failed', completedAt: { $gte: from } } },
      { $sort: { completedAt: 1 } },
      { $group: { _id: '$error.code', count: { $sum: 1 }, lastAt: { $max: '$completedAt' }, models: { $addToSet: '$model' }, sample: { $last: '$error.message' } } },
      { $sort: { count: -1 } },
      { $limit: 30 },
    ]),
    GenerationJob.find({ status: 'failed', completedAt: { $gte: from } })
      .sort({ completedAt: -1 })
      .limit(50)
      .select('userId kind model subjectType error submitAttempts completedAt providerState')
      .lean(),
  ]);
  const userIds = [...new Set(recentJobs.map((item) => String(item.userId)))];
  const users = new Map((await User.find({ _id: { $in: userIds } }).select('email').lean()).map((user) => [String(user._id), user.email]));
  return {
    since: from,
    jobs: jobGroups.map((group) => ({ code: group._id || 'UNKNOWN', count: group.count, lastAt: group.lastAt, models: group.models, sample: redactText(group.sample) })),
    recentJobs: recentJobs.map((job) => ({
      id: String(job._id),
      userEmail: users.get(String(job.userId)) || null,
      kind: job.kind,
      model: job.model,
      subjectType: job.subjectType || null,
      code: job.error?.code || 'UNKNOWN',
      message: redactText(job.error?.message),
      attempts: job.submitAttempts || 0,
      at: job.completedAt,
    })),
  };
}

// ---------------------------------------------------------------- generations

/** Every user's infographics for the admin monitor. Errors are redacted; prompts are not included. */
export async function listAllInfographics({ status = 'all', search, page = 1, limit = 25 } = {}) {
  const filter = {};
  if (status && status !== 'all') filter.status = status === 'active' ? { $in: ['queued', 'processing'] } : status;
  if (search) {
    const term = String(search).trim().slice(0, 100);
    if (isObjectId(term)) filter.$or = [{ _id: term }, { userId: term }, { jobId: term }];
    else {
      const pattern = new RegExp(escapeRegex(term), 'i');
      const userIds = (await User.find({ email: pattern }).select('_id').limit(200).lean()).map((user) => user._id);
      filter.$or = [{ userId: { $in: userIds } }, { title: pattern }];
    }
  }
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const safePage = Math.max(1, page);
  const [items, total] = await Promise.all([
    Infographic.find(filter).sort({ createdAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
    Infographic.countDocuments(filter),
  ]);
  const owners = await User.find({ _id: { $in: [...new Set(items.map((item) => String(item.userId)))] } }).select('email').lean();
  const emails = new Map(owners.map((user) => [String(user._id), user.email]));
  return {
    items: items.map((item) => {
      const dto = toAdminInfographicDto(item, emails.get(String(item.userId)));
      return dto.error ? { ...dto, error: { code: dto.error.code, message: redactText(dto.error.message) } } : dto;
    }),
    total,
    page: safePage,
    limit: safeLimit,
  };
}

/** MCP operational view: connections, recent tool calls and their failures. */
export async function mcpMonitor({ days = 7 } = {}) {
  const from = since(Math.min(Math.max(1, days), 30) * DAY);
  const toolCall = /^mcp\.tool\./;
  const [settings, byStatus, byTool, recentFailures, lastUsed] = await Promise.all([
    getPlatformSettings(),
    countBy(McpConnection, 'status'),
    AuditLog.aggregate([
      { $match: { area: 'mcp', action: toolCall, createdAt: { $gte: from } } },
      {
        $group: {
          _id: '$metadata.tool',
          calls: { $sum: 1 },
          failures: { $sum: { $cond: [{ $eq: ['$outcome', 'failure'] }, 1, 0] } },
          lastAt: { $max: '$createdAt' },
        },
      },
      { $sort: { calls: -1 } },
    ]),
    AuditLog.find({ area: 'mcp', action: toolCall, outcome: 'failure', createdAt: { $gte: from } }).sort({ createdAt: -1 }).limit(30).lean(),
    McpConnection.findOne({ lastUsedAt: { $ne: null } }).sort({ lastUsedAt: -1 }).select('lastUsedAt').lean(),
  ]);
  return {
    since: from,
    enabled: env.MCP_ENABLED && settings.access.mcpEnabled,
    url: env.mcpResourceUrl,
    connections: {
      active: byStatus.active || 0,
      revoked: byStatus.revoked || 0,
      total: Object.values(byStatus).reduce((sum, value) => sum + value, 0),
      lastUsedAt: lastUsed?.lastUsedAt || null,
    },
    tools: byTool.map((row) => ({ tool: row._id || 'unknown', calls: row.calls, failures: row.failures, lastAt: row.lastAt })),
    recentFailures: recentFailures.map((entry) => ({
      id: String(entry._id),
      userEmail: entry.actorEmail || null,
      tool: entry.metadata?.tool || null,
      client: entry.metadata?.client || null,
      code: entry.metadata?.errorCode || 'ERROR',
      at: entry.createdAt,
    })),
  };
}

// ---------------------------------------------------------------- ops logs

export async function listOpsLogs({ level = 'all', search, page = 1, limit = 50 } = {}) {
  const filter = {};
  if (level && level !== 'all' && OPS_LEVELS.includes(level)) filter.level = level;
  if (search) filter.message = new RegExp(escapeRegex(String(search).trim().slice(0, 100)), 'i');
  const safeLimit = Math.min(Math.max(1, limit), 200);
  const safePage = Math.max(1, page);
  const [items, total] = await Promise.all([
    OpsLog.find(filter).sort({ at: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
    OpsLog.countDocuments(filter),
  ]);
  return {
    items: items.map((item) => ({ id: String(item._id), level: item.level, message: item.message, context: item.context, instance: item.instance, at: item.at })),
    total,
    page: safePage,
    limit: safeLimit,
  };
}

// ---------------------------------------------------------------- AI connections

export async function listAllConnections({ status = 'all', search, page = 1, limit = 50 } = {}) {
  const filter = {};
  if (status && status !== 'all') filter.status = status;
  if (search) {
    const pattern = new RegExp(escapeRegex(String(search).trim().slice(0, 100)), 'i');
    const userIds = (await User.find({ email: pattern }).select('_id').limit(200).lean()).map((user) => user._id);
    filter.$or = [{ clientName: pattern }, { userId: { $in: userIds } }];
  }
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const safePage = Math.max(1, page);
  const [items, total] = await Promise.all([
    McpConnection.find(filter).sort({ status: 1, createdAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
    McpConnection.countDocuments(filter),
  ]);
  const users = new Map(
    (await User.find({ _id: { $in: items.map((item) => item.userId) } }).select('email name').lean()).map((user) => [String(user._id), user]),
  );
  return {
    items: items.map((item) => ({
      ...toConnectionDto(item),
      userId: String(item.userId),
      userEmail: users.get(String(item.userId))?.email || null,
    })),
    total,
    page: safePage,
    limit: safeLimit,
  };
}

export async function revokeConnectionAsAdmin(actor, id, req) {
  if (!isObjectId(String(id))) throw new NotFoundError('Connection not found');
  const connection = await McpConnection.findById(id).lean();
  if (!connection) throw new NotFoundError('Connection not found');
  if (connection.status === 'active') {
    await revokeGrantArtifacts(connection.grantId);
    await McpConnection.updateOne(
      { _id: connection._id, status: 'active' },
      { $set: { status: 'revoked', revokedAt: new Date(), revokedReason: 'admin' } },
    );
    const owner = await User.findById(connection.userId).select('email').lean();
    await recordAudit({
      req,
      actor,
      action: 'admin.mcp_connection_revoked',
      area: 'admin',
      target: { type: 'mcp_connection', id: connection._id, email: owner?.email },
      summary: `Revoked AI connection "${connection.clientName || 'AI app'}" of ${owner?.email || 'a user'}`.slice(0, 500),
    });
  }
  const updated = await McpConnection.findById(connection._id).lean();
  return toConnectionDto(updated);
}

export async function connectionsOfUser(userId) {
  const items = await McpConnection.find({ userId }).sort({ status: 1, createdAt: -1 }).limit(50).lean();
  return items.map(toConnectionDto);
}

export async function usageOfUser(userId) {
  const [infographics, jobs, failedJobs] = await Promise.all([
    countInfographicsOf(userId),
    GenerationJob.countDocuments({ userId }),
    GenerationJob.countDocuments({ userId, status: 'failed' }),
  ]);
  return { infographics: infographics.total, infographicsCompleted: infographics.completed, infographicsFailed: infographics.failed, jobs, failedJobs };
}

// ---------------------------------------------------------------- providers

function usedFor(modelId) {
  return modelId === INFOGRAPHIC_MODEL ? ['Infographic generation'] : [];
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export async function providerOverview() {
  const [settings, keys, invalid, failed24h] = await Promise.all([
    getPlatformSettings(),
    ApiCredential.countDocuments({ provider: 'kie' }),
    ApiCredential.countDocuments({ provider: 'kie', status: 'invalid' }),
    countBy(GenerationJob, 'model', { status: 'failed', completedAt: { $gte: since(DAY) } }),
  ]);
  const disabled = new Set(settings.models.disabled);
  return {
    providers: [
      {
        key: 'kie',
        name: 'Kie.ai',
        apiHost: hostOf(env.KIE_API_BASE_URL),
        uploadHost: hostOf(env.KIE_UPLOAD_BASE_URL),
        keys: { saved: keys, invalid },
        note: 'Users generate with credits on the platform key above, then with their own Kie.ai key. User keys are encrypted and never shown to administrators.',
        models: KIE_MODELS.map((model) => ({
          id: model.id,
          label: model.label,
          kind: model.kind,
          description: model.description,
          usedFor: usedFor(model.id),
          enabled: !disabled.has(model.id),
          failed24h: failed24h[model.id] || 0,
        })),
      },
    ],
  };
}

export async function setProviderModel(actor, providerKey, modelId, enabled, req) {
  if (providerKey !== 'kie' || !KIE_MODELS.some((model) => model.id === modelId)) throw new NotFoundError('Model not found');
  await setModelEnabled(actor, modelId, enabled, req);
  return providerOverview();
}
