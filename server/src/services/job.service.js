// Generation jobs as seen by the API (users, admins, provider callbacks).
// The worker side lives in src/jobs/.
import { assertGenerationAllowed, assertModelEnabled } from './platformSettings.service.js';
import crypto from 'node:crypto';
import { GenerationJob } from '../models/GenerationJob.js';
import { Infographic } from '../models/Infographic.js';
import { ApiCredential } from '../models/ApiCredential.js';
import { User } from '../models/User.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { getProvider, InputError } from '../providers/providerRegistry.js';
import { AppError, NotFoundError, ValidationError } from '../utils/errors.js';
import { escapeRegex, isObjectId } from '../utils/sanitize.js';
import { hashToken, looksLikeToken } from '../utils/tokens.js';
import { ACTIVE_STATUSES, TERMINAL_STATUSES, jobEvent, pushEvent } from '../jobs/queue.js';
import { timeoutMsFor, callbackPath } from '../jobs/handlers/providerTask.js';
import { getJobKey, chargeRetry } from './credit.service.js';
import { recordAudit } from './audit.service.js';

const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;
// Time a job may wait in the queue (e.g. behind the per-user limit) before its
// own generation timeout starts counting at submission.
const QUEUE_ALLOWANCE_MS = 60 * 60 * 1000;

const PHASE_MESSAGES = {
  pending_submit: 'Waiting to start',
  submitting: 'Sending to the provider',
  reconcile: 'Checking whether the provider received the request',
};

const PROVIDER_STATE_MESSAGES = {
  waiting: 'Queued at the provider',
  queuing: 'Queued at the provider',
  generating: 'Generating',
};

function messageFor(job) {
  if (job.status === 'completed') return 'Done';
  if (job.status === 'failed' || job.status === 'cancelled') return job.error?.message || job.status;
  if (job.cancelRequested) return 'Cancelling';
  if (job.phase === 'polling') return PROVIDER_STATE_MESSAGES[job.providerState] || 'Submitted; waiting for the provider';
  return PHASE_MESSAGES[job.phase] || 'Queued';
}

function needsConfirmation(job) {
  return Boolean(job.submissionUncertain || (job.status === 'cancelled' && job.providerTaskId));
}

export function toJobDto(job, { admin = false, userEmail } = {}) {
  const input = job.request?.input || {};
  const prompt = typeof input.prompt === 'string' ? input.prompt : '';
  const terminal = TERMINAL_STATUSES.includes(job.status);
  return {
    id: String(job._id),
    kind: job.kind,
    provider: job.provider,
    model: job.model,
    status: job.status,
    phase: job.phase,
    message: messageFor(job),
    providerTaskId: job.providerTaskId || null,
    providerState: job.providerState || null,
    submitAttempts: job.submitAttempts || 0,
    pollCount: job.pollCount || 0,
    submissionUncertain: Boolean(job.submissionUncertain),
    result: job.status === 'completed' || job.result?.creditsConsumed != null ? {
      urls: job.result?.urls || [],
      lastFrameUrls: job.result?.lastFrameUrls || [],
      creditsConsumed: job.result?.creditsConsumed ?? null,
      costTimeSeconds: job.result?.costTimeSeconds ?? null,
    } : null,
    error: job.error?.code ? { code: job.error.code, message: job.error.message } : null,
    canCancel: !terminal && !job.cancelRequested,
    canRetry: job.status === 'failed' || job.status === 'cancelled',
    retryNeedsConfirmation: needsConfirmation(job),
    retryOf: job.retryOf ? String(job.retryOf) : null,
    subjectType: job.subjectType || null,
    subjectId: job.subjectId || null,
    // Owners see their own request; admins get a short preview only.
    request: admin
      ? { promptPreview: prompt.slice(0, 120) }
      : { input },
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt || null,
    completedAt: job.completedAt || null,
    timeoutAt: job.timeoutAt,
    events: (job.events || []).slice(-20).map((event) => ({ at: event.at, type: event.type, message: event.message })),
    ...(admin ? { userId: String(job.userId), userEmail: userEmail || null } : {}),
  };
}

/**
 * For jobs on the user's own key: it must exist and must not have been
 * rejected by the provider. (Credit-paid infographics run on the platform key
 * instead; see credit.service.js.)
 */
export async function assertUsableKey(userId, provider) {
  const credential = await ApiCredential.findOne({ userId, provider: provider.key }).select('status').lean();
  if (!credential) {
    throw new AppError(`Connect your own ${provider.name} API key in API Settings before generating.`, {
      statusCode: 400,
      code: 'NO_API_KEY',
    });
  }
  if (credential.status === 'invalid') {
    throw new AppError(`${provider.name} rejected your saved API key. Replace it in API Settings before generating.`, {
      statusCode: 400,
      code: 'API_KEY_INVALID',
    });
  }
}

function hashInput(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/**
 * Queue a generation job for `user`. It runs on the user's OWN provider key,
 * unless `keySource` is 'platform' (an infographic already paid with platform
 * credits). Duplicate protection:
 *   - same Idempotency-Key from the same user -> the existing job is returned
 *   - identical request still queued/running from the last 2 minutes -> returned
 */
export async function createJob(
  user,
  {
    kind,
    provider: providerKey = 'kie',
    model,
    params,
    idempotencyKey,
    subjectType,
    subjectId,
    subjectMeta,
    assetIds = [],
    keySource = 'user',
  },
  { internal = false } = {},
) {
  const provider = getProvider(providerKey);
  if (!provider) throw new NotFoundError(`Unknown provider "${providerKey}"`);
  if (!internal) {
    await assertGenerationAllowed();
    await assertModelEnabled(model);
  }

  const usedAssetIds = [...assetIds.map(String)];

  let request;
  try {
    request = provider.buildTask(kind, model, { ...(params || {}) });
  } catch (error) {
    if (error instanceof InputError) throw new ValidationError(error.message, { [error.field || 'params']: error.message });
    throw error;
  }

  if (keySource !== 'platform') await assertUsableKey(user._id, provider);

  if (idempotencyKey) {
    const existing = await GenerationJob.findOne({ userId: user._id, idempotencyKey });
    if (existing) return { job: existing, deduplicated: true };
  }

  const inputHash = hashInput({ provider: provider.key, kind, request, subjectType: subjectType || null, subjectId: subjectId || null });
  const recent = await GenerationJob.findOne({
    userId: user._id,
    inputHash,
    status: { $in: ACTIVE_STATUSES },
    createdAt: { $gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
  }).sort({ createdAt: -1 });
  if (recent) return { job: recent, deduplicated: true };

  const now = Date.now();
  try {
    const job = await GenerationJob.create({
      userId: user._id,
      kind,
      provider: provider.key,
      model: request.model,
      request,
      subjectType: subjectType || null,
      subjectId: subjectId || null,
      subjectMeta: subjectMeta || null,
      keySource: keySource === 'platform' ? 'platform' : 'user',
      assetIds: [...new Set(usedAssetIds)],
      status: 'queued',
      phase: 'pending_submit',
      maxSubmitAttempts: env.JOB_MAX_ATTEMPTS,
      idempotencyKey: idempotencyKey || null,
      inputHash,
      nextRunAt: new Date(now),
      timeoutAt: new Date(now + QUEUE_ALLOWANCE_MS + timeoutMsFor(kind)),
      events: [jobEvent('queued', 'Job created')],
    });
    return { job, deduplicated: false };
  } catch (error) {
    if (error?.code === 11000 && idempotencyKey) {
      const existing = await GenerationJob.findOne({ userId: user._id, idempotencyKey });
      if (existing) return { job: existing, deduplicated: true };
    }
    throw error;
  }
}

export async function listJobs(userId, { status, kind, page = 1, limit = 20 } = {}) {
  const filter = { userId };
  if (status && status !== 'all') filter.status = status;
  if (kind && kind !== 'all') filter.kind = kind;
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const safePage = Math.max(1, page);
  const [items, total] = await Promise.all([
    GenerationJob.find(filter).sort({ createdAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
    GenerationJob.countDocuments(filter),
  ]);
  return { items: items.map((job) => toJobDto(job)), total, page: safePage, limit: safeLimit };
}

async function findJobFor(actor, id, { admin }) {
  if (!isObjectId(id)) throw new NotFoundError('Job not found');
  const job = admin ? await GenerationJob.findById(id) : await GenerationJob.findOne({ _id: id, userId: actor._id });
  if (!job) throw new NotFoundError('Job not found');
  return job;
}

export async function getJob(userId, id) {
  if (!isObjectId(id)) throw new NotFoundError('Job not found');
  const job = await GenerationJob.findOne({ _id: id, userId }).lean();
  if (!job) throw new NotFoundError('Job not found');
  return toJobDto(job);
}

export async function cancelJob(actor, id, { admin = false, req } = {}) {
  const job = await findJobFor(actor, id, { admin });
  if (TERMINAL_STATUSES.includes(job.status)) {
    throw new AppError(`This job is already ${job.status}.`, { statusCode: 409, code: 'JOB_FINISHED' });
  }
  // Never sent and not being worked on: cancel right away.
  const immediate = await GenerationJob.findOneAndUpdate(
    {
      _id: job._id,
      phase: 'pending_submit',
      $or: [{ lockedUntil: null }, { lockedUntil: { $lte: new Date() } }],
    },
    {
      $set: {
        status: 'cancelled',
        phase: 'done',
        cancelRequested: true,
        completedAt: new Date(),
        'error.code': 'CANCELLED',
        'error.message': 'Cancelled before it was sent to the provider.',
      },
      $push: pushEvent(jobEvent('cancelled', admin ? `Cancelled by administrator ${actor.email}` : 'Cancelled by you')),
    },
    { returnDocument: 'after' },
  );
  const updated =
    immediate ||
    (await GenerationJob.findOneAndUpdate(
      { _id: job._id, status: { $in: ACTIVE_STATUSES } },
      {
        $set: { cancelRequested: true, nextRunAt: new Date() },
        $push: pushEvent(jobEvent('cancel_requested', admin ? `Cancel requested by administrator ${actor.email}` : 'Cancel requested')),
      },
      { returnDocument: 'after' },
    ));
  if (admin) {
    await recordAudit({ req, actor, action: 'admin.job_cancelled', area: 'admin', target: { type: 'job', id: job._id }, metadata: { model: job.model } });
  }
  return toJobDto(updated || job, { admin });
}

export async function retryJob(actor, id, { confirmDuplicateRisk = false, admin = false, req } = {}) {
  const job = await findJobFor(actor, id, { admin });
  if (!['failed', 'cancelled'].includes(job.status)) {
    throw new AppError('Only failed or cancelled jobs can be retried.', { statusCode: 409, code: 'JOB_NOT_RETRYABLE' });
  }
  if (needsConfirmation(job) && !confirmDuplicateRisk) {
    throw new AppError(
      'The provider may already have run (and charged for) the original task. Check your Kie.ai logs first, then confirm to retry anyway.',
      { statusCode: 409, code: 'CONFIRMATION_REQUIRED' },
    );
  }
  await assertGenerationAllowed();
  const keySource = job.keySource === 'platform' ? 'platform' : 'user';
  if (keySource === 'platform') {
    await chargeRetry(Infographic, job.subjectType === 'infographic' ? job.subjectId : null);
  } else {
    await assertUsableKey(job.userId, getProvider(job.provider));
  }
  const now = Date.now();
  const retry = await GenerationJob.create({
    userId: job.userId,
    kind: job.kind,
    provider: job.provider,
    model: job.model,
    request: job.request,
    subjectType: job.subjectType,
    subjectId: job.subjectId,
    subjectMeta: job.subjectMeta || null,
    keySource,
    assetIds: job.assetIds || [],
    status: 'queued',
    phase: 'pending_submit',
    maxSubmitAttempts: env.JOB_MAX_ATTEMPTS,
    inputHash: job.inputHash,
    retryOf: job._id,
    nextRunAt: new Date(now),
    timeoutAt: new Date(now + QUEUE_ALLOWANCE_MS + timeoutMsFor(job.kind)),
    events: [jobEvent('queued', `Retry of job ${job._id}${confirmDuplicateRisk ? ' (duplicate-charge risk confirmed)' : ''}`)],
  });
  // An infographic follows its newest job, so the retried result is saved to it.
  if (job.subjectType === 'infographic' && job.subjectId) {
    await Infographic.updateOne(
      { _id: job.subjectId, userId: job.userId, jobId: job._id, 'image.assetId': null },
      { $set: { jobId: retry._id, status: 'queued', 'error.code': null, 'error.message': null, completedAt: null, 'saving.attempts': 0, 'saving.claimedUntil': null } },
    );
  }
  await recordAudit({
    req,
    actor,
    action: admin ? 'admin.job_retried' : 'jobs.retried',
    area: admin ? 'admin' : 'account',
    target: { type: 'job', id: job._id },
    metadata: { newJobId: String(retry._id), confirmedDuplicateRisk: Boolean(confirmDuplicateRisk) },
  });
  return toJobDto(retry, { admin });
}

export async function adminListJobs({ status, kind, search, page = 1, limit = 25 } = {}) {
  const filter = {};
  if (status && status !== 'all') filter.status = status;
  if (kind && kind !== 'all') filter.kind = kind;
  if (search) {
    const term = search.trim();
    if (isObjectId(term)) filter.$or = [{ _id: term }, { userId: term }];
    else {
      const users = await User.find({ email: new RegExp(escapeRegex(term), 'i') }).select('_id').limit(50).lean();
      filter.$or = [
        { userId: { $in: users.map((u) => u._id) } },
        { providerTaskId: term },
        { model: new RegExp(escapeRegex(term), 'i') },
      ];
    }
  }
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const safePage = Math.max(1, page);
  const [items, total] = await Promise.all([
    GenerationJob.find(filter).sort({ createdAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
    GenerationJob.countDocuments(filter),
  ]);
  const owners = await User.find({ _id: { $in: [...new Set(items.map((j) => String(j.userId)))] } }).select('email').lean();
  const emails = new Map(owners.map((u) => [String(u._id), u.email]));
  return {
    items: items.map((job) => toJobDto(job, { admin: true, userEmail: emails.get(String(job.userId)) })),
    total,
    page: safePage,
    limit: safeLimit,
  };
}

export async function jobStats() {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [queued, processing, failed24h, completed24h] = await Promise.all([
    GenerationJob.countDocuments({ status: 'queued' }),
    GenerationJob.countDocuments({ status: 'processing' }),
    GenerationJob.countDocuments({ status: 'failed', completedAt: { $gte: since } }),
    GenerationJob.countDocuments({ status: 'completed', completedAt: { $gte: since } }),
  ]);
  return { queued, processing, failed24h, completed24h };
}

function timingSafeEqualHex(a, b) {
  const left = Buffer.from(String(a || ''), 'hex');
  const right = Buffer.from(String(b || ''), 'hex');
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

/**
 * Provider callback (webhook). The URL carries a per-job capability token.
 * The payload is never trusted on its own: the task is looked up at the
 * provider with the job owner's key, and must have been created with this
 * job's callback URL. Only then is its task id attached, which is how an
 * uncertain submission is reconciled without resending it.
 */
export async function handleProviderCallback(providerKey, jobId, token, payload) {
  const provider = getProvider(providerKey);
  if (!provider || !isObjectId(jobId) || !looksLikeToken(token)) return { accepted: false };
  const job = await GenerationJob.findOne({ _id: jobId, provider: provider.key }).select('+callbackTokenHash');
  if (!job || !job.callbackTokenHash || !timingSafeEqualHex(hashToken(token), job.callbackTokenHash)) {
    return { accepted: false };
  }
  const taskId = payload?.data?.taskId || payload?.data?.task_id;
  if (typeof taskId !== 'string' || !taskId || taskId.length > 200) return { accepted: false };

  if (job.providerTaskId) {
    if (job.providerTaskId === taskId && ACTIVE_STATUSES.includes(job.status)) {
      await GenerationJob.updateOne({ _id: job._id }, { $set: { nextRunAt: new Date() } });
    }
    return { accepted: job.providerTaskId === taskId };
  }

  const reopenable = ACTIVE_STATUSES.includes(job.status) || (job.status === 'failed' && job.error?.code === 'SUBMISSION_UNCERTAIN');
  if (!reopenable) return { accepted: false };

  let task;
  try {
    const stored = await getJobKey(job);
    if (!stored) return { accepted: false };
    task = await provider.fetchTask(stored.apiKey, taskId);
  } catch (error) {
    logger.warn({ jobId: String(job._id), reason: error.message }, 'Callback could not be verified with the provider');
    return { accepted: false };
  }
  const expected = callbackPath(job);
  const reportedToken = task.callBackUrl?.split(expected)[1]?.split(/[/?#]/)[0];
  if (!task.callBackUrl || !task.callBackUrl.includes(expected) || !timingSafeEqualHex(hashToken(reportedToken), job.callbackTokenHash)) {
    logger.warn({ jobId: String(job._id) }, 'Callback task does not belong to this job; ignored');
    return { accepted: false };
  }

  const now = Date.now();
  const updated = await GenerationJob.updateOne(
    { _id: job._id, providerTaskId: null },
    {
      $set: {
        providerTaskId: taskId,
        status: 'processing',
        phase: 'polling',
        submissionUncertain: false,
        completedAt: null,
        'error.code': null,
        'error.message': null,
        nextRunAt: new Date(now),
        timeoutAt: new Date(now + timeoutMsFor(job.kind)),
        lockedBy: null,
        lockedUntil: null,
      },
      $push: pushEvent(jobEvent('reconciled', `Provider callback confirmed task ${taskId}; resuming without resending`)),
    },
  );
  return { accepted: updated.modifiedCount === 1 };
}
