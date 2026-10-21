import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as controller from '../controllers/infographic.controller.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireDatabase } from '../middleware/requireDatabase.js';
import { TooManyRequestsError } from '../utils/errors.js';
import {
  createInfographicBody,
  regenerateBody,
  listInfographicsQuery,
  infographicIdParam,
  imageQuery,
} from '../validators/infographic.validator.js';

export function createInfographicRouter({ env }) {
  const router = Router();
  // Generations count against the same per-user cap as POST /api/jobs.
  const generateLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: env.JOB_CREATE_RATE_LIMIT_PER_MINUTE,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => `user:${req.user?._id}`,
    handler: (_req, _res, next) => next(new TooManyRequestsError('Too many generation requests. Please wait a minute.')),
  });

  router.use(requireDatabase, authenticate);

  router.get('/options', controller.options);
  router.get('/', validate({ query: listInfographicsQuery }), controller.list);
  router.post('/', generateLimiter, validate({ body: createInfographicBody }), controller.create);
  router.get('/:id', validate({ params: infographicIdParam }), controller.get);
  router.delete('/:id', validate({ params: infographicIdParam }), controller.remove);
  router.post('/:id/regenerate', generateLimiter, validate({ params: infographicIdParam, body: regenerateBody }), controller.regenerate);
  router.get('/:id/image', validate({ params: infographicIdParam, query: imageQuery }), controller.image);

  return router;
}
