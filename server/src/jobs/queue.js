// Durable job queue on MongoDB.
//
// A worker claims one due job at a time with an atomic findOneAndUpdate that
// sets a lease (lockedBy + lockedUntil). Only the lease holder may change the
// job; if a worker dies, the lease expires and another worker (or the same one
// after a restart) picks the job up. Nothing lives only in memory.
import { GenerationJob } from '../models/GenerationJob.js';
import { env } from '../config/env.js';

export const ACTIVE_STATUSES = Object.freeze(['queued', 'processing']);
export const TERMINAL_STATUSES = Object.freeze(['completed', 'failed', 'cancelled']);

export function jobEvent(type, message) {
  return { at: new Date(), type, message: message ? String(message).slice(0, 500) : null };
}

/** Push an event while keeping only the most recent 40. */
export function pushEvent(event) {
  return { events: { $each: [event], $slice: -40 } };
}

export async function claimNextJob(workerId, { now = new Date() } = {}) {
  return GenerationJob.findOneAndUpdate(
    {
      status: { $in: ACTIVE_STATUSES },
      nextRunAt: { $lte: now },
      $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }],
    },
    { $set: { lockedBy: workerId, lockedUntil: new Date(now.getTime() + env.JOB_LEASE_MS) } },
    { sort: { nextRunAt: 1 }, returnDocument: 'after' },
  );
}

/**
 * Release the lease and apply `set`. Only succeeds for the current lease
 * holder, so a worker whose lease expired cannot overwrite newer state.
 */
export async function releaseJob(jobId, workerId, set = {}, event = null) {
  const update = { $set: { ...set, lockedBy: null, lockedUntil: null } };
  if (event) update.$push = pushEvent(event);
  const result = await GenerationJob.updateOne({ _id: jobId, lockedBy: workerId }, update);
  return result.modifiedCount === 1;
}
