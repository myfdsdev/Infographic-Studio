// Infographics: the one feature of AI Infographic Studio.
//
//   createInfographic -> credit.service decides how it is paid (platform
//   credits on the platform key, else the user's OWN key) ->
//   job.service.createJob (Z-Image on Kie.ai) -> the worker submits and polls
//   the provider -> processInfographics (worker step) downloads the finished
//   image and stores it privately as an Asset, or refunds credits if it failed.
//
// The dashboard routes and the MCP tools both call this service, so
// validation, ownership, billing and duplicate protection are identical.
import { Infographic, INFOGRAPHIC_STYLES, INFOGRAPHIC_RATIOS, INFOGRAPHIC_LAYOUTS } from '../models/Infographic.js';
import { GenerationJob } from '../models/GenerationJob.js';
import { getProvider } from '../providers/providerRegistry.js';
import { TERMINAL_STATUSES } from '../jobs/queue.js';
import { logger } from '../config/logger.js';
import { createJob, toJobDto } from './job.service.js';
import * as credits from './credit.service.js';
import * as assetService from './asset.service.js';
import { recordAudit } from './audit.service.js';
import { buildInfographicPrompt, cleanTopic, titleFromTopic, describeOptions, TOPIC_MIN, TOPIC_MAX, LEGACY_RATIOS } from './infographicPrompt.js';
import { AppError, NotFoundError, ValidationError } from '../utils/errors.js';
import { isObjectId } from '../utils/sanitize.js';

const PROVIDER_KEY = 'kie';
// Z-Image supports 1:1, 3:4 and 9:16 natively and always returns PNG (see
// providers/kie/capabilities.js). It has no resolution setting.
export const INFOGRAPHIC_MODEL = 'z-image';
const ACTIVE = ['queued', 'processing'];
const CLAIM_MS = 2 * 60 * 1000;
const MAX_SAVE_ATTEMPTS = 3;

function provider() {
  return getProvider(PROVIDER_KEY);
}

export function infographicOptions() {
  return { ...describeOptions(), model: { id: INFOGRAPHIC_MODEL, label: provider().findModel(INFOGRAPHIC_MODEL)?.label || INFOGRAPHIC_MODEL } };
}

export function contentPath(item) {
  return item.image?.assetId ? `/api/infographics/${item._id}/image` : null;
}

/** Owner-facing shape. `job` (optional) adds live progress for active items. */
export function toInfographicDto(item, job = null) {
  const active = ACTIVE.includes(item.status);
  return {
    id: String(item._id),
    title: item.title,
    topic: item.topic,
    style: item.style,
    layout: item.layout || 'auto',
    aspectRatio: item.aspectRatio,
    billing: {
      paidWith: item.billing?.source === 'platform' ? 'credits' : 'own_key',
      credits: item.billing?.credits || 0,
      refunded: Boolean(item.billing?.refundedAt),
    },
    model: item.model,
    source: item.source,
    status: item.status,
    progress: active && job ? { phase: job.phase, message: toJobDto(job).message, providerState: job.providerState || null } : null,
    image: item.image?.assetId
      ? {
          url: contentPath(item),
          width: item.image.width,
          height: item.image.height,
          mimeType: item.image.mimeType,
          size: item.image.size,
        }
      : null,
    error: item.error?.code ? { code: item.error.code, message: item.error.message } : null,
    jobId: item.jobId ? String(item.jobId) : null,
    regeneratedFrom: item.regeneratedFrom ? String(item.regeneratedFrom) : null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    completedAt: item.completedAt || null,
  };
}

function validateInput({ topic, style, aspectRatio, layout = 'auto' }) {
  const text = cleanTopic(topic);
  const details = {};
  if (text.length < TOPIC_MIN) details.topic = `Describe the topic in at least ${TOPIC_MIN} characters`;
  else if (text.length > TOPIC_MAX) details.topic = `Keep the topic under ${TOPIC_MAX} characters`;
  if (!INFOGRAPHIC_STYLES.includes(style)) details.style = `Choose one of: ${INFOGRAPHIC_STYLES.join(', ')}`;
  if (!INFOGRAPHIC_RATIOS.includes(aspectRatio)) details.aspectRatio = `Choose one of: ${INFOGRAPHIC_RATIOS.join(', ')}`;
  if (!INFOGRAPHIC_LAYOUTS.includes(layout)) details.layout = `Choose one of: ${INFOGRAPHIC_LAYOUTS.join(', ')}`;
  if (Object.keys(details).length) throw new ValidationError(Object.values(details)[0], details);
  return { topic: text, style, aspectRatio, layout };
}

/**
 * Start an infographic. It is paid with platform credits when the user has
 * enough, otherwise with the user's own key. Throws NO_CREDITS / NO_API_KEY /
 * API_KEY_INVALID before anything is created when neither is available.
 */
export async function createInfographic(user, body, { idempotencyKey, source = 'web', regeneratedFrom = null, req } = {}) {
  const input = validateInput(body || {});
  const prompt = buildInfographicPrompt(input);

  // A repeated request (same Idempotency-Key) returns the first result before
  // any credits are looked at, so a double click never pays or fails twice.
  if (idempotencyKey) {
    const earlier = await GenerationJob.findOne({ userId: user._id, idempotencyKey }).lean();
    const existing = earlier && (await Infographic.findOne({ userId: user._id, jobId: earlier._id }));
    if (existing) return { infographic: toInfographicDto(existing, earlier), deduplicated: true };
  }

  const billing = await credits.reserveForInfographic(user);
  let created;
  try {
    created = await createJob(user, {
      kind: 'image',
      provider: PROVIDER_KEY,
      model: INFOGRAPHIC_MODEL,
      params: { prompt, aspectRatio: input.aspectRatio },
      subjectType: 'infographic',
      subjectMeta: { style: input.style, layout: input.layout, aspectRatio: input.aspectRatio, source },
      idempotencyKey,
      keySource: billing.source,
    });
  } catch (error) {
    await credits.releaseReservation(user._id, billing);
    throw error;
  }
  const { job, deduplicated } = created;

  if (deduplicated) {
    await credits.releaseReservation(user._id, billing);
    const existing = await Infographic.findOne({ userId: user._id, jobId: job._id });
    if (existing) return { infographic: toInfographicDto(existing, job), deduplicated: true };
  }

  const item = await Infographic.create({
    userId: user._id,
    topic: input.topic,
    title: titleFromTopic(input.topic),
    style: input.style,
    layout: input.layout,
    aspectRatio: input.aspectRatio,
    model: job.model,
    prompt,
    source,
    regeneratedFrom,
    billing: deduplicated ? { source: job.keySource || 'user', credits: 0 } : { source: billing.source, credits: billing.credits },
    jobId: job._id,
    status: job.status === 'processing' ? 'processing' : 'queued',
  });
  await GenerationJob.updateOne({ _id: job._id, subjectId: null }, { $set: { subjectId: String(item._id) } });
  if (!deduplicated) await credits.recordSpend(user._id, billing, item._id);

  await recordAudit({
    req,
    actor: user,
    action: source === 'mcp' ? 'infographic.created_via_mcp' : 'infographic.created',
    area: 'account',
    target: { type: 'infographic', id: item._id },
    summary: `Infographic started (${input.layout}, ${input.style}, ${input.aspectRatio}, ${
      billing.source === 'platform' ? `${billing.credits} credits` : 'own key'
    })${regeneratedFrom ? ' as a regeneration' : ''}`,
    metadata: {
      style: input.style,
      layout: input.layout,
      aspectRatio: input.aspectRatio,
      source,
      topicLength: input.topic.length,
      paidWith: billing.source,
      credits: billing.credits,
    },
  });

  return { infographic: toInfographicDto(item, job), deduplicated: false };
}

async function ownedInfographic(userId, id) {
  if (!isObjectId(String(id))) throw new NotFoundError('Infographic not found');
  const item = await Infographic.findOne({ _id: id, userId });
  if (!item) throw new NotFoundError('Infographic not found');
  return item;
}

/** Keep the record's status in step with its job while it runs. */
async function withLiveStatus(item) {
  if (!ACTIVE.includes(item.status)) return { item, job: null };
  const job = await GenerationJob.findById(item.jobId).lean();
  if (!job) return { item, job: null };
  if (job.status === 'processing' && item.status === 'queued') {
    await Infographic.updateOne({ _id: item._id, status: 'queued' }, { $set: { status: 'processing' } });
    item.status = 'processing';
  }
  return { item, job };
}

export async function getInfographic(user, id) {
  const { item, job } = await withLiveStatus(await ownedInfographic(user._id, id));
  return toInfographicDto(item, job);
}

export async function listInfographics(user, { status = 'all', page = 1, limit = 24 } = {}) {
  const filter = { userId: user._id };
  if (status && status !== 'all') filter.status = status === 'active' ? { $in: ACTIVE } : status;
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const safePage = Math.max(1, page);
  const [items, total] = await Promise.all([
    Infographic.find(filter).sort({ createdAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit),
    Infographic.countDocuments(filter),
  ]);
  const jobs = await GenerationJob.find({ _id: { $in: items.filter((i) => ACTIVE.includes(i.status)).map((i) => i.jobId) } }).lean();
  const byId = new Map(jobs.map((job) => [String(job._id), job]));
  return {
    items: items.map((item) => toInfographicDto(item, byId.get(String(item.jobId)) || null)),
    total,
    page: safePage,
    limit: safeLimit,
    pages: Math.max(1, Math.ceil(total / safeLimit)),
  };
}

/**
 * A new infographic with the same topic, layout, style and shape. Older records keep
 * a ratio or topic length Z-Image no longer takes, so those are brought into
 * range (4:5 becomes 3:4; a long topic is shortened at a word boundary).
 */
export async function regenerateInfographic(user, id, { idempotencyKey, source = 'web', req } = {}) {
  const original = await ownedInfographic(user._id, id);
  let topic = cleanTopic(original.topic);
  if (topic.length > TOPIC_MAX) topic = topic.slice(0, TOPIC_MAX).replace(/\s+\S*$/, '').trim();
  return createInfographic(
    user,
    {
      topic,
      style: original.style,
      layout: original.layout || 'auto',
      aspectRatio: LEGACY_RATIOS[original.aspectRatio] || original.aspectRatio,
    },
    { idempotencyKey, source, regeneratedFrom: original._id, req },
  );
}

export async function openInfographicImage(user, id) {
  const item = await ownedInfographic(user._id, id);
  if (!item.image?.assetId) throw new AppError('This infographic has no image yet.', { statusCode: 404, code: 'IMAGE_NOT_READY' });
  const { asset, stream } = await assetService.openAssetContent(user._id, String(item.image.assetId));
  return { item, asset, stream };
}

export async function deleteInfographic(user, id, req) {
  const item = await ownedInfographic(user._id, id);
  if (ACTIVE.includes(item.status)) {
    throw new AppError('This infographic is still being generated. Wait until it finishes, then delete it.', {
      statusCode: 409,
      code: 'INFOGRAPHIC_ACTIVE',
    });
  }
  await Infographic.deleteOne({ _id: item._id });
  if (item.image?.assetId) await assetService.removeAssetsIfUnused(user._id, [item.image.assetId]);
  await recordAudit({ req, actor: user, action: 'infographic.deleted', area: 'account', target: { type: 'infographic', id: item._id } });
}

/** Account deletion: every record (files are removed with all assets). */
export async function deleteAllInfographicsOf(userId) {
  const result = await Infographic.deleteMany({ userId });
  return result.deletedCount || 0;
}

// ---------------------------------------------------------------- worker step

async function release(id, set) {
  await Infographic.updateOne({ _id: id }, { $set: { ...set, 'saving.claimedUntil': null } });
}

async function saveFinished(item, job) {
  if (job.status !== 'completed') {
    const cancelled = job.status === 'cancelled';
    await release(item._id, {
      status: cancelled ? 'cancelled' : 'failed',
      'error.code': job.error?.code || (cancelled ? 'CANCELLED' : 'GENERATION_FAILED'),
      'error.message': String(job.error?.message || (cancelled ? 'The generation was cancelled.' : 'The infographic could not be generated.')).slice(0, 1000),
      completedAt: job.completedAt || new Date(),
    });
    await credits.refundInfographic(Infographic, item);
    return 'failed';
  }
  const url = job.result?.urls?.[0];
  try {
    if (!url) throw new AppError('The provider returned no image.', { statusCode: 502, code: 'RESULT_MISSING' });
    const stored = await credits.getJobKey(job).catch(() => null);
    let file;
    try {
      file = await assetService.downloadGeneratedFile(url, { provider: provider(), apiKey: stored?.apiKey });
    } catch (error) {
      throw assetService.describeDownloadError(error);
    }
    const asset = await assetService.storeGeneratedImage(item.userId, { buffer: file.buffer, purpose: 'infographic_image', sourceJobId: job._id });
    const updated = await Infographic.updateOne(
      { _id: item._id, 'image.assetId': null },
      {
        $set: {
          status: 'completed',
          image: { assetId: asset._id, width: asset.width, height: asset.height, mimeType: asset.mimeType, size: asset.size },
          'error.code': null,
          'error.message': null,
          completedAt: new Date(),
          'saving.claimedUntil': null,
        },
      },
    );
    if (!updated.modifiedCount) await assetService.removeAssetsIfUnused(item.userId, [asset._id]);
    return 'saved';
  } catch (error) {
    const attempts = (item.saving?.attempts || 0) + 1;
    logger.warn({ infographicId: String(item._id), jobId: String(job._id), attempts, code: error.code, reason: error.message }, 'Could not save the infographic image');
    if (attempts >= MAX_SAVE_ATTEMPTS || error.code === 'PROVIDER_KEY_REJECTED') {
      await release(item._id, {
        status: 'failed',
        'saving.attempts': attempts,
        'error.code': error.code || 'RESULT_SAVE_FAILED',
        'error.message': `The image was generated but could not be saved: ${error.message}`.slice(0, 1000),
        completedAt: new Date(),
      });
      await credits.refundInfographic(Infographic, item);
      return 'failed';
    }
    // Leave the claim to run out, then try again.
    await Infographic.updateOne({ _id: item._id }, { $set: { 'saving.attempts': attempts } });
    return 'retry';
  }
}

/**
 * Worker step: copy finished images into storage and mark failed or
 * cancelled jobs. Each record is claimed first so two workers never save the
 * same image. Returns the number of records handled.
 */
export async function processInfographics({ limit = 5, now = new Date() } = {}) {
  const pending = await Infographic.find({ status: { $in: ACTIVE } }).select('jobId').sort({ updatedAt: 1 }).limit(200).lean();
  if (!pending.length) return 0;
  const finished = await GenerationJob.find({ _id: { $in: pending.map((item) => item.jobId) }, status: { $in: TERMINAL_STATUSES } })
    .limit(limit)
    .lean();
  let handled = 0;
  for (const job of finished) {
    const item = await Infographic.findOneAndUpdate(
      {
        jobId: job._id,
        status: { $in: ACTIVE },
        $or: [{ 'saving.claimedUntil': null }, { 'saving.claimedUntil': { $lte: now } }],
      },
      { $set: { 'saving.claimedUntil': new Date(now.getTime() + CLAIM_MS) } },
      { returnDocument: 'after' },
    ).lean();
    if (!item) continue;
    await saveFinished(item, job);
    handled += 1;
  }
  return handled;
}

// ---------------------------------------------------------------- admin

export function toAdminInfographicDto(item, userEmail) {
  return {
    id: String(item._id),
    userId: String(item.userId),
    userEmail: userEmail || null,
    title: item.title,
    style: item.style,
    layout: item.layout || 'auto',
    aspectRatio: item.aspectRatio,
    source: item.source,
    status: item.status,
    error: item.error?.code ? { code: item.error.code, message: item.error.message } : null,
    jobId: item.jobId ? String(item.jobId) : null,
    createdAt: item.createdAt,
    completedAt: item.completedAt || null,
  };
}

export async function infographicStats() {
  const day = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [byStatus, created24h, bySource, byStyle, byLayout] = await Promise.all([
    Infographic.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Infographic.countDocuments({ createdAt: { $gte: day } }),
    Infographic.aggregate([{ $group: { _id: '$source', count: { $sum: 1 } } }]),
    Infographic.aggregate([{ $group: { _id: '$style', count: { $sum: 1 } } }]),
    Infographic.aggregate([{ $group: { _id: { $ifNull: ['$layout', 'auto'] }, count: { $sum: 1 } } }]),
  ]);
  const map = (rows) => Object.fromEntries(rows.map((row) => [row._id || 'unknown', row.count]));
  const status = map(byStatus);
  const total = Object.values(status).reduce((sum, value) => sum + value, 0);
  return {
    total,
    completed: status.completed || 0,
    failed: status.failed || 0,
    cancelled: status.cancelled || 0,
    active: (status.queued || 0) + (status.processing || 0),
    created24h,
    bySource: map(bySource),
    byStyle: map(byStyle),
    byLayout: map(byLayout),
  };
}

export async function countInfographicsOf(userId) {
  const [total, completed, failed] = await Promise.all([
    Infographic.countDocuments({ userId }),
    Infographic.countDocuments({ userId, status: 'completed' }),
    Infographic.countDocuments({ userId, status: 'failed' }),
  ]);
  return { total, completed, failed };
}
