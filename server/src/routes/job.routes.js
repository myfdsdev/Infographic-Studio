import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as controller from '../controllers/job.controller.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireDatabase } from '../middleware/requireDatabase.js';
import { TooManyRequestsError } from '../utils/errors.js';
import { createJobBody, listJobsQuery, retryJobBody } from '../validators/job.validator.js';

export function createJobRouter({ env }) {
  const router = Router();
  // Per-user cap on new jobs (on top of the per-user concurrency limit).
  const createLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: env.JOB_CREATE_RATE_LIMIT_PER_MINUTE,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => `user:${req.user?._id}`,
    handler: (_req, _res, next) => next(new TooManyRequestsError('Too many generation requests. Please wait a minute.')),
  });

  router.use(requireDatabase, authenticate);

  router.get('/', validate({ query: listJobsQuery }), controller.list);
  router.post('/', createLimiter, validate({ body: createJobBody }), controller.create);
  router.get('/:id', controller.get);
  router.post('/:id/cancel', controller.cancel);
  router.post('/:id/retry', validate({ body: retryJobBody }), controller.retry);

  return router;
}
