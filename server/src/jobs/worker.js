// In-process background worker.
//
//   - Every JOB_POLL_INTERVAL_MS it claims due jobs until WORKER_CONCURRENCY
//     jobs are being advanced at once (global concurrency limit per process).
//   - Per-user concurrency is enforced inside the handler.
//   - Each job step is short (one provider call at most), so long generations
//     never tie up a worker slot; they are re-scheduled with nextRunAt.
//   - Several API instances can run workers against the same database: the
//     atomic claim + lease guarantees one owner per job at a time.
import { getPlatformSettings } from '../services/platformSettings.service.js';
import os from 'node:os';
import crypto from 'node:crypto';
import { isDatabaseConnected } from '../config/database.js';
import { claimNextJob, releaseJob, jobEvent } from './queue.js';
import { recoverInterruptedJobs } from './recovery.js';
import { processProviderJob } from './handlers/providerTask.js';
import { cleanupOrphanAssets } from '../services/asset.service.js';
import { processInfographics } from '../services/infographic.service.js';

export function createWorker({ env, logger, workerId } = {}) {
  const id = workerId || `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString('hex')}`;
  const inFlight = new Set();
  let tickTimer = null;
  let recoveryTimer = null;
  let ticking = false;
  let infographicTicking = false;
  let infographicPass = null;
  let stopping = false;

  async function runJob(job) {
    try {
      await processProviderJob(job, { workerId: id });
    } catch (error) {
      logger.error({ jobId: String(job._id), reason: error.message }, 'Job step failed unexpectedly');
      // Keep the phase as it is (a "submitting" job will be reconciled, not resent).
      await releaseJob(
        job._id,
        id,
        { nextRunAt: new Date(Date.now() + env.JOB_RETRY_BASE_MS) },
        jobEvent('worker_error', 'Unexpected server error; the job will be checked again shortly'),
      ).catch(() => {});
    }
  }

  // Finished infographic jobs are saved to private storage in their own loop,
  // so a slow download never blocks job claims.
  async function tickInfographics() {
    if (infographicTicking || stopping || !isDatabaseConnected()) return;
    infographicTicking = true;
    infographicPass = processInfographics()
      .catch((error) => logger.error({ reason: error.message }, 'Infographic tick failed'))
      .finally(() => {
        infographicTicking = false;
      });
    await infographicPass;
  }

  async function tick() {
    tickInfographics();
    if (ticking || stopping || !isDatabaseConnected()) return;
    ticking = true;
    try {
      const { limits } = await getPlatformSettings();
      while (!stopping && inFlight.size < limits.workerConcurrency) {
        const job = await claimNextJob(id);
        if (!job) break;
        const promise = runJob(job).finally(() => inFlight.delete(promise));
        inFlight.add(promise);
      }
    } catch (error) {
      logger.error({ reason: error.message }, 'Worker tick failed');
    } finally {
      ticking = false;
    }
  }

  async function recover() {
    if (!isDatabaseConnected()) return;
    try {
      const result = await recoverInterruptedJobs();
      if (result.interrupted || result.released) logger.warn(result, 'Recovered interrupted jobs');
    } catch (error) {
      logger.error({ reason: error.message }, 'Job recovery failed');
    }
    try {
      const removed = await cleanupOrphanAssets();
      if (removed) logger.info({ removed }, 'Removed unused stored images');
    } catch (error) {
      logger.error({ reason: error.message }, 'Stored image cleanup failed');
    }
  }

  return {
    id,
    get activeCount() {
      return inFlight.size;
    },
    async start() {
      stopping = false;
      await recover();
      tickTimer = setInterval(tick, env.JOB_POLL_INTERVAL_MS);
      recoveryTimer = setInterval(recover, 60 * 1000);
      tickTimer.unref?.();
      recoveryTimer.unref?.();
      logger.info({ workerId: id, concurrency: env.WORKER_CONCURRENCY, perUser: env.JOB_USER_CONCURRENCY }, 'Job worker started');
      tick();
    },
    async stop({ timeoutMs = 10000 } = {}) {
      stopping = true;
      clearInterval(tickTimer);
      clearInterval(recoveryTimer);
      await Promise.race([
        Promise.allSettled([...inFlight, ...(infographicPass ? [infographicPass] : [])]),
        new Promise((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
    },
    tick,
    recover,
    /** Test helper: save finished infographics until none is left. Returns the number handled. */
    async drainInfographics({ maxSteps = 20 } = {}) {
      let handled = 0;
      for (let step = 0; step < maxSteps; step += 1) {
        const count = await processInfographics();
        if (!count) break;
        handled += count;
      }
      return handled;
    },
    /**
     * Test helper: claim and process due jobs one after another until none
     * are due. Returns the number of steps taken.
     */
    async drain({ maxSteps = 100 } = {}) {
      let steps = 0;
      while (steps < maxSteps) {
        const job = await claimNextJob(id);
        if (!job) break;
        await runJob(job);
        steps += 1;
      }
      return steps;
    },
  };
}
