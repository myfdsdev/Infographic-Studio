import { Router } from 'express';
import * as controller from '../controllers/admin.controller.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { requireDatabase } from '../middleware/requireDatabase.js';
import { objectIdParam } from '../validators/settings.validator.js';
import {
  listUsersQuery,
  updateUserBody,
  listAuditLogsQuery,
  failuresQuery,
  opsLogsQuery,
  connectionsQuery,
  providerParam,
  modelBody,
  brandingImageParam,
  brandingUploadFields,
  adminInfographicsQuery,
  mcpMonitorQuery,
  creditAdjustmentBody,
  createBonusLinkBody,
  updateBonusLinkBody,
} from '../validators/admin.validator.js';
import { saveCredentialBody } from '../validators/job.validator.js';
import * as creditsController from '../controllers/credits.controller.js';
import { adminListJobsQuery, retryJobBody } from '../validators/job.validator.js';
import { platformSettingsBody } from '../services/platformSettings.service.js';
import { brandingBody } from '../services/branding.service.js';
import * as platform from '../controllers/adminPlatform.controller.js';
import { createImageReceiver } from './asset.routes.js';

// Every route below requires an active administrator. The check runs on the
// server for every request; hiding the admin UI is only a convenience.
export function createAdminRouter({ env }) {
  const router = Router();

  router.use(requireDatabase, authenticate, requireAdmin);

  router.get('/stats', platform.stats);
  router.get('/system', platform.system);
  router.get('/failures', validate({ query: failuresQuery }), platform.failures);
  router.get('/ops-logs', validate({ query: opsLogsQuery }), platform.opsLogs);

  router.get('/settings', platform.getSettings);
  router.patch('/settings', validate({ body: platformSettingsBody }), platform.updateSettings);

  router.get('/providers', platform.providers);
  router.put('/providers/:provider/models', validate({ params: providerParam, body: modelBody }), platform.setModel);

  // The platform's own Kie.ai key (pays credit-paid generations).
  router.get('/platform-key', creditsController.getPlatformKey);
  router.put('/platform-key', validate({ body: saveCredentialBody }), creditsController.savePlatformKey);
  router.post('/platform-key/test', creditsController.testPlatformKey);
  router.delete('/platform-key', creditsController.deletePlatformKey);

  router.get('/bonus-links', creditsController.listBonusLinks);
  router.post('/bonus-links', validate({ body: createBonusLinkBody }), creditsController.createBonusLink);
  router.get('/bonus-links/:id', validate({ params: objectIdParam }), creditsController.getBonusLink);
  router.patch('/bonus-links/:id', validate({ params: objectIdParam, body: updateBonusLinkBody }), creditsController.updateBonusLink);

  router.get('/infographics', validate({ query: adminInfographicsQuery }), platform.infographics);
  router.get('/mcp/monitor', validate({ query: mcpMonitorQuery }), platform.mcpMonitor);
  router.get('/mcp/connections', validate({ query: connectionsQuery }), platform.connections);
  router.delete('/mcp/connections/:id', validate({ params: objectIdParam }), platform.revokeConnection);

  router.get('/branding', platform.getBranding);
  router.put('/branding', validate({ body: brandingBody }), platform.updateBranding);
  router.post('/branding/reset', platform.resetBranding);
  router.post(
    '/branding/:kind',
    createImageReceiver(env),
    validate({ params: brandingImageParam, body: brandingUploadFields }),
    platform.uploadBrandingImage,
  );
  router.delete('/branding/:kind', validate({ params: brandingImageParam }), platform.resetBrandingImage);

  router.get('/users', validate({ query: listUsersQuery }), controller.listUsers);
  router.get('/users/:id', validate({ params: objectIdParam }), controller.getUser);
  router.patch('/users/:id', validate({ params: objectIdParam, body: updateUserBody }), controller.updateUser);
  router.post('/users/:id/act-as', validate({ params: objectIdParam }), controller.actAsUser);
  router.post('/users/:id/credits', validate({ params: objectIdParam, body: creditAdjustmentBody }), creditsController.adjustUserCredits);
  router.get('/users/:id/credits', validate({ params: objectIdParam }), creditsController.userTransactions);
  router.get('/audit-logs', validate({ query: listAuditLogsQuery }), controller.listAuditLogs);
  router.get('/jobs', validate({ query: adminListJobsQuery }), controller.listJobs);
  router.post('/jobs/:id/retry', validate({ body: retryJobBody }), controller.retryJob);
  router.post('/jobs/:id/cancel', controller.cancelJob);

  return router;
}
