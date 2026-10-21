import { Router } from 'express';
import * as controller from '../controllers/webhook.controller.js';
import { validate } from '../middleware/validate.js';
import { requireDatabase } from '../middleware/requireDatabase.js';
import { webhookParams } from '../validators/job.validator.js';

// Provider callbacks. No session: the URL itself carries a per-job token, and
// every claim is re-verified with the provider before it changes anything.
export function createWebhookRouter() {
  const router = Router();
  router.post('/:provider/:jobId/:token', requireDatabase, validate({ params: webhookParams }), controller.providerCallback);
  return router;
}
