import { Router } from 'express';
import * as controller from '../controllers/mcp.controller.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireDatabase } from '../middleware/requireDatabase.js';
import { createAuthLimiter } from '../middleware/rateLimit.js';
import { connectionIdParam, interactionParam, approveConsentBody } from '../validators/mcp.validator.js';

/** /api/mcp: MCP Connection page data (signed-in user). */
export function createMcpRouter() {
  const router = Router();
  router.use(requireDatabase, authenticate);
  router.get('/info', controller.info);
  router.get('/connections', controller.listConnections);
  router.delete('/connections/:id', validate({ params: connectionIdParam }), controller.revokeConnection);
  router.get('/activity', controller.activity);
  return router;
}

/** /api/oauth: the consent page's calls (signed-in user). */
export function createConsentRouter({ env }) {
  const router = Router();
  const limiter = createAuthLimiter(env);
  router.use(requireDatabase, authenticate);
  router.get('/interactions/:uid', validate({ params: interactionParam }), controller.getConsent);
  router.post('/interactions/:uid/approve', limiter, validate({ params: interactionParam, body: approveConsentBody }), controller.approveConsent);
  router.post('/interactions/:uid/deny', limiter, validate({ params: interactionParam }), controller.denyConsent);
  return router;
}
