// Restart recovery. Runs when a worker starts and then every minute.
//
//   - A job left in "submitting" with an expired lease was interrupted while
//     its createTask call was in flight. The provider may or may not have the
//     task, so it goes to "reconcile"; it is never resent blindly.
//   - Any other job with an expired lease is simply unlocked so the next tick
//     resumes it from its stored phase (e.g. polling an existing task id).
import { GenerationJob } from '../models/GenerationJob.js';
import { env } from '../config/env.js';
import { jobEvent, pushEvent } from './queue.js';

export async function recoverInterruptedJobs({ now = new Date() } = {}) {
  const reconcileDeadline = new Date(now.getTime() + (env.PUBLIC_WEBHOOK_BASE_URL ? env.JOB_RECONCILE_MINUTES * 60 * 1000 : 0));
  const interrupted = await GenerationJob.updateMany(
    { status: 'processing', phase: 'submitting', lockedUntil: { $lte: now } },
    {
      $set: {
        phase: 'reconcile',
        submissionUncertain: true,
        reconcileDeadline,
        nextRunAt: now,
        lockedBy: null,
        lockedUntil: null,
      },
      $push: pushEvent(jobEvent('recovered', 'The server stopped while this task was being sent. It was not resent automatically.')),
    },
  );
  const released = await GenerationJob.updateMany(
    { status: { $in: ['queued', 'processing'] }, phase: { $ne: 'submitting' }, lockedBy: { $ne: null }, lockedUntil: { $lte: now } },
    { $set: { lockedBy: null, lockedUntil: null } },
  );
  return { interrupted: interrupted.modifiedCount || 0, released: released.modifiedCount || 0 };
}
