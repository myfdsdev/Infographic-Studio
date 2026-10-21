// The provider-task state machine shared by every generation job.
//
//   pending_submit --submit ok--------------------------> polling --success--> completed
//        |   ^                                               |    \--fail-----> failed
//        |   '--definitely not created, retryable (backoff)  '--timeout-------> failed
//        |--rejected (bad key, no credits, bad input)------------------------> failed
//        '--outcome unknown (timeout / connection lost / 5xx after sending)
//                 |
//                 v
//             reconcile --callback proves the task exists--> polling
//                 '--no evidence before the deadline-------> failed (SUBMISSION_UNCERTAIN)
//
// The write-ahead "submitting" phase is stored BEFORE the provider is called.
// If the process dies mid-call, the job is found in "submitting" with an
// expired lease and goes to reconcile, never straight back to submit. A task
// is therefore sent at most once unless the provider certainly rejected it.
import { getPlatformSettings } from '../../services/platformSettings.service.js';
import { GenerationJob } from '../../models/GenerationJob.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { Asset } from '../../models/Asset.js';
import { getProvider, ProviderError, isAssetRef, ASSET_REF_PREFIX } from '../../providers/providerRegistry.js';
import { getDecryptedKey, markCredentialInvalid } from '../../services/credential.service.js';
import { providerUrlFor } from '../../services/asset.service.js';
import { generateToken, hashToken } from '../../utils/tokens.js';
import { releaseJob, jobEvent, pushEvent } from '../queue.js';

const minutes = (value) => value * 60 * 1000;

export function timeoutMsFor(_kind) {
  return minutes(env.JOB_IMAGE_TIMEOUT_MINUTES);
}

function callbacksEnabled() {
  return Boolean(env.PUBLIC_WEBHOOK_BASE_URL);
}

export function callbackPath(job) {
  return `/api/webhooks/${job.provider}/${job._id}/`;
}

function pollDelay(pollCount) {
  return Math.min(env.JOB_POLL_MAX_MS, Math.round(env.JOB_POLL_MIN_MS * 1.5 ** Math.max(0, pollCount)));
}

function retryDelay(attempt) {
  const base = env.JOB_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1);
  return base + Math.round(Math.random() * Math.min(1000, base * 0.2));
}

async function finish(job, workerId, status, { code = null, message = null, result } = {}, eventType) {
  const now = new Date();
  const set = {
    status,
    phase: 'done',
    completedAt: now,
    ...(status !== 'completed' ? { 'error.code': code, 'error.message': message } : { 'error.code': null, 'error.message': null }),
  };
  if (result) {
    for (const [key, value] of Object.entries(result)) {
      if (value !== undefined) set[`result.${key}`] = value;
    }
  }
  const fallback = { completed: 'Generation finished', failed: 'Generation failed', cancelled: 'Cancelled' }[status] || null;
  await releaseJob(job._id, workerId, set, jobEvent(eventType || status, message || fallback));
}

async function toReconcile(job, workerId, reason) {
  const now = Date.now();
  const deadline = callbacksEnabled() ? now + minutes(env.JOB_RECONCILE_MINUTES) : now;
  await releaseJob(
    job._id,
    workerId,
    {
      status: 'processing',
      phase: 'reconcile',
      submissionUncertain: true,
      reconcileDeadline: new Date(deadline),
      nextRunAt: new Date(callbacksEnabled() ? now + Math.min(30000, env.JOB_POLL_MAX_MS) : now),
    },
    jobEvent('submission_uncertain', reason),
  );
}

const FAIL_CODES = {
  auth: 'PROVIDER_KEY_REJECTED',
  insufficient_credits: 'INSUFFICIENT_CREDITS',
  validation: 'INVALID_REQUEST',
  feature_disabled: 'MODEL_DISABLED',
  not_found: 'PROVIDER_NOT_FOUND',
  rate_limited: 'RATE_LIMITED',
  maintenance: 'PROVIDER_UNAVAILABLE',
};

// ---------------------------------------------------------------- references

function collectAssetRefs(value, found = new Set()) {
  if (Array.isArray(value)) value.forEach((item) => collectAssetRefs(item, found));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectAssetRefs(item, found));
  else if (isAssetRef(value)) found.add(value.slice(ASSET_REF_PREFIX.length));
  return found;
}

function replaceAssetRefs(value, urls) {
  if (Array.isArray(value)) return value.map((item) => replaceAssetRefs(item, urls));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceAssetRefs(item, urls)]));
  }
  if (isAssetRef(value)) return urls.get(value.slice(ASSET_REF_PREFIX.length));
  return value;
}

/**
 * Turn "asset://<id>" placeholders into URLs the provider can fetch, by
 * uploading the owner's stored images with the owner's key. Uploads create no
 * task and cost nothing, so they may be retried. Returns the ready request, or
 * null when the job was rescheduled or failed here.
 */
async function prepareRequest(job, workerId, provider, apiKey) {
  const ids = [...collectAssetRefs(job.request?.input)];
  if (!ids.length) return job.request;

  const assets = await Asset.find({ _id: { $in: ids }, userId: job.userId });
  if (assets.length !== ids.length) {
    await finish(job, workerId, 'failed', {
      code: 'ASSET_MISSING',
      message: 'A reference image used by this job was deleted. Approve or upload it again, then generate a new preview.',
    });
    return null;
  }

  const urls = new Map();
  try {
    for (const asset of assets) urls.set(String(asset._id), await providerUrlFor(asset, { provider, apiKey }));
  } catch (error) {
    // Provider upload problems and storage outages are retried: nothing has
    // been sent to a model yet, so retrying can never charge twice.
    const storageDown = error?.code === 'STORAGE_UNAVAILABLE';
    if (error instanceof ProviderError || storageDown) {
      if (error.kind === 'auth') {
        await markCredentialInvalid(job.userId, job.provider, error.message);
        await finish(job, workerId, 'failed', { code: 'PROVIDER_KEY_REJECTED', message: error.message });
        return null;
      }
      const attempts = (job.prepareAttempts || 0) + 1;
      if (attempts < job.maxSubmitAttempts) {
        const delay = retryDelay(attempts);
        await GenerationJob.updateOne({ _id: job._id, lockedBy: workerId }, { $inc: { prepareAttempts: 1 } });
        await releaseJob(
          job._id,
          workerId,
          { nextRunAt: new Date(Date.now() + delay) },
          jobEvent('retry_scheduled', `${error.message}. Retrying in ${Math.round(delay / 1000)} s (nothing was generated yet).`),
        );
        return null;
      }
      await finish(job, workerId, 'failed', {
        code: 'REFERENCE_UPLOAD_FAILED',
        message: `${error.message} (gave up after ${attempts} attempts). Nothing was generated or charged.`,
      });
      return null;
    }
    logger.error({ jobId: String(job._id), reason: error.message }, 'Reference image could not be prepared');
    await finish(job, workerId, 'failed', {
      code: 'ASSET_MISSING',
      message: 'A stored reference image could not be read. Upload or approve it again, then generate a new preview.',
    });
    return null;
  }
  return { model: job.request.model, input: replaceAssetRefs(job.request.input, urls) };
}

async function submit(job, workerId) {
  const provider = getProvider(job.provider);
  const now = new Date();

  // Paused by the administrator: nothing new is sent to the provider.
  const platform = await getPlatformSettings();
  if (!platform.access.generationEnabled) {
    const alreadyNoted = (job.events || []).some((event) => event.type === 'paused');
    await releaseJob(
      job._id,
      workerId,
      { nextRunAt: new Date(now.getTime() + Math.max(1000, env.JOB_POLL_MAX_MS)) },
      alreadyNoted ? null : jobEvent('paused', 'Waiting: new generations are paused by the administrator'),
    );
    return;
  }

  // Per-user concurrency: never more than N tasks in flight at the provider.
  const inFlight = await GenerationJob.countDocuments({
    userId: job.userId,
    _id: { $ne: job._id },
    status: 'processing',
    phase: { $in: ['submitting', 'polling', 'reconcile'] },
  });
  if (inFlight >= platform.limits.userConcurrency) {
    const alreadyNoted = (job.events || []).some((event) => event.type === 'waiting_for_slot');
    await releaseJob(
      job._id,
      workerId,
      { nextRunAt: new Date(now.getTime() + Math.max(1, env.JOB_POLL_MIN_MS)) },
      alreadyNoted ? null : jobEvent('waiting_for_slot', `Waiting: ${inFlight} of your jobs are already running`),
    );
    return;
  }

  let stored;
  try {
    stored = await getDecryptedKey(job.userId, job.provider);
  } catch (error) {
    await finish(job, workerId, 'failed', { code: error.code || 'KEY_UNREADABLE', message: error.message });
    return;
  }
  if (!stored) {
    await finish(job, workerId, 'failed', {
      code: 'NO_API_KEY',
      message: `No ${provider.name} API key is saved. Add one in API settings, then retry.`,
    });
    return;
  }

  const ready = await prepareRequest(job, workerId, provider, stored.apiKey);
  if (!ready) return;

  const token = callbacksEnabled() ? generateToken(24) : null;
  const callBackUrl = token ? `${env.PUBLIC_WEBHOOK_BASE_URL.replace(/\/+$/, '')}${callbackPath(job)}${token}` : undefined;

  // Write-ahead: record that a submission is starting BEFORE calling out.
  const claimed = await GenerationJob.findOneAndUpdate(
    { _id: job._id, lockedBy: workerId, phase: 'pending_submit' },
    {
      $set: {
        status: 'processing',
        phase: 'submitting',
        submissionStartedAt: now,
        startedAt: job.startedAt || now,
        callbackTokenHash: token ? hashToken(token) : null,
      },
      $inc: { submitAttempts: 1 },
      $push: pushEvent(jobEvent('submitting', `Sending to ${provider.name} (attempt ${job.submitAttempts + 1})`)),
    },
    { returnDocument: 'after' },
  );
  if (!claimed) return; // lease lost; another worker owns the job now

  let taskId;
  try {
    taskId = await provider.submit(stored.apiKey, ready, { callBackUrl });
  } catch (error) {
    if (!(error instanceof ProviderError)) {
      logger.error({ jobId: String(job._id), reason: error.message }, 'Unexpected error while submitting');
      await toReconcile(claimed, workerId, 'Unexpected error after the request was prepared; not resent automatically');
      return;
    }
    if (error.uncertain) {
      await toReconcile(claimed, workerId, `${error.message}. The provider may have started the task, so it was not resent.`);
      return;
    }
    if (error.kind === 'auth') await markCredentialInvalid(job.userId, job.provider, error.message);
    const retryable = error.retryable && claimed.submitAttempts < claimed.maxSubmitAttempts;
    if (retryable) {
      const delay = retryDelay(claimed.submitAttempts);
      await releaseJob(
        job._id,
        workerId,
        { phase: 'pending_submit', nextRunAt: new Date(Date.now() + delay) },
        jobEvent('retry_scheduled', `${error.message}. Retrying in ${Math.round(delay / 1000)} s (the task was not created).`),
      );
      return;
    }
    await finish(claimed, workerId, 'failed', {
      code: FAIL_CODES[error.kind] || 'PROVIDER_ERROR',
      message: error.retryable ? `${error.message} (gave up after ${claimed.submitAttempts} attempts)` : error.message,
    });
    return;
  }

  // Record the task id even if our lease expired meanwhile: it is the truth.
  const started = new Date();
  await GenerationJob.updateOne(
    { _id: job._id, providerTaskId: null },
    {
      $set: {
        providerTaskId: taskId,
        phase: 'polling',
        status: 'processing',
        submissionUncertain: false,
        timeoutAt: new Date(started.getTime() + timeoutMsFor(job.kind)),
        nextRunAt: new Date(started.getTime() + env.JOB_POLL_MIN_MS),
        pollCount: 0,
        lockedBy: null,
        lockedUntil: null,
      },
      $push: pushEvent(jobEvent('submitted', `${provider.name} task ${taskId} created`)),
    },
  );
}

async function reconcile(job, workerId) {
  if (job.providerTaskId) {
    await releaseJob(job._id, workerId, { phase: 'polling', submissionUncertain: false, nextRunAt: new Date() }, jobEvent('reconciled', 'Provider task found'));
    return;
  }
  const now = Date.now();
  const deadline = job.reconcileDeadline ? new Date(job.reconcileDeadline).getTime() : now;
  if (now < deadline) {
    await releaseJob(job._id, workerId, { nextRunAt: new Date(Math.min(deadline, now + 30000)) });
    return;
  }
  await finish(
    job,
    workerId,
    'failed',
    {
      code: 'SUBMISSION_UNCERTAIN',
      message:
        'We could not confirm whether the provider started this task (the request timed out or the connection dropped after it was sent). ' +
        'It was not resent automatically, so you are not charged twice. Check your Kie.ai logs at kie.ai/logs; if the task is not there, retry this job.',
    },
    'gave_up_reconciling',
  );
}

async function poll(job, workerId) {
  const provider = getProvider(job.provider);
  let stored;
  try {
    stored = await getDecryptedKey(job.userId, job.provider);
  } catch (error) {
    await finish(job, workerId, 'failed', { code: error.code || 'KEY_UNREADABLE', message: error.message });
    return;
  }
  if (!stored) {
    await finish(job, workerId, 'failed', {
      code: 'NO_API_KEY',
      message: 'The API key was removed while this task was running, so its result cannot be collected. The provider may still finish (and charge for) the task.',
    });
    return;
  }

  let task;
  try {
    task = await provider.fetchTask(stored.apiKey, job.providerTaskId);
  } catch (error) {
    if (error instanceof ProviderError && error.kind === 'auth') {
      await markCredentialInvalid(job.userId, job.provider, error.message);
      await finish(job, workerId, 'failed', { code: 'PROVIDER_KEY_REJECTED', message: `${error.message} while checking the task` });
      return;
    }
    if (error instanceof ProviderError && (error.kind === 'validation' || error.kind === 'not_found')) {
      await finish(job, workerId, 'failed', {
        code: 'TASK_NOT_FOUND',
        message: 'The provider no longer finds this task for the saved key (the key may belong to a different account now).',
      });
      return;
    }
    const pollErrors = (job.pollErrors || 0) + 1;
    await GenerationJob.updateOne({ _id: job._id }, { $inc: { pollErrors: 1 } });
    await releaseJob(
      job._id,
      workerId,
      { nextRunAt: new Date(Date.now() + pollDelay(pollErrors + 1)) },
      pollErrors === 1 || pollErrors % 10 === 0 ? jobEvent('poll_error', error.message) : null,
    );
    return;
  }

  if (task.state === 'succeeded') {
    await finish(
      job,
      workerId,
      'completed',
      {
        result: {
          urls: task.resultUrls,
          lastFrameUrls: task.lastFrameUrls.length ? task.lastFrameUrls : undefined,
          creditsConsumed: task.creditsConsumed,
          costTimeSeconds: task.costTimeSeconds,
        },
      },
      'completed',
    );
    return;
  }
  if (task.state === 'failed') {
    await finish(job, workerId, 'failed', {
      code: 'PROVIDER_GENERATION_FAILED',
      message: task.error?.message || 'The provider reported that generation failed',
      result: { creditsConsumed: task.creditsConsumed },
    });
    return;
  }

  const pollCount = (job.pollCount || 0) + 1;
  await releaseJob(
    job._id,
    workerId,
    { providerState: task.providerState, pollCount, nextRunAt: new Date(Date.now() + pollDelay(pollCount)) },
    job.providerState !== task.providerState ? jobEvent('provider_state', `Provider state: ${task.providerState}`) : null,
  );
}

/** Advance one job by one step. The caller holds the job's lease. */
export async function processProviderJob(job, { workerId }) {
  if (!getProvider(job.provider)) {
    await finish(job, workerId, 'failed', { code: 'UNKNOWN_PROVIDER', message: `Unknown provider ${job.provider}` });
    return;
  }
  if (job.cancelRequested) {
    await finish(
      job,
      workerId,
      'cancelled',
      {
        code: 'CANCELLED',
        message: job.providerTaskId
          ? 'Cancelled. The provider has no cancel option, so the task may still finish and be charged on your provider account.'
          : 'Cancelled before it was sent to the provider.',
      },
      'cancelled',
    );
    return;
  }
  if (Date.now() >= new Date(job.timeoutAt).getTime()) {
    await finish(job, workerId, 'failed', {
      code: 'TIMEOUT',
      message: job.providerTaskId
        ? 'The provider did not finish in time. If it finishes later it may still be charged; check your Kie.ai logs.'
        : 'The job could not be started in time.',
    });
    return;
  }

  switch (job.phase) {
    case 'pending_submit':
      return submit(job, workerId);
    case 'submitting':
      // Only reachable when a previous worker died mid-call (lease expired).
      return toReconcile(job, workerId, 'The server stopped while this task was being sent. It was not resent automatically.');
    case 'reconcile':
      return reconcile(job, workerId);
    case 'polling':
      return poll(job, workerId);
    default:
      await releaseJob(job._id, workerId, {});
      return undefined;
  }
}
