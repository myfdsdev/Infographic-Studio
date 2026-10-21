// API route registry. Feature routers are mounted here as their phases land.
import { Router } from 'express';
import { createHealthRouter } from './health.routes.js';
import { createAuthRouter } from './auth.routes.js';
import { createSettingsRouter } from './settings.routes.js';
import { createAdminRouter } from './admin.routes.js';
import { createJobRouter } from './job.routes.js';
import { createWebhookRouter } from './webhook.routes.js';
import { createAssetRouter } from './asset.routes.js';
import { createInfographicRouter } from './infographic.routes.js';
import { createMcpRouter, createConsentRouter } from './mcp.routes.js';
import { createBrandingRouter } from './branding.routes.js';
import pkg from '../../package.json' with { type: 'json' };

const ENDPOINTS = [
  'GET /api/health',
  'GET /api/ready',
  'POST /api/auth/signup',
  'POST /api/auth/login',
  'POST /api/auth/logout',
  'GET /api/auth/me',
  'POST /api/auth/forgot-password',
  'POST /api/auth/reset-password',
  'GET /api/auth/options',
  'GET /api/auth/google/start|connect|callback',
  'GET|PATCH /api/settings/account',
  'POST /api/settings/account/password',
  'POST /api/settings/account/delete',
  'POST /api/settings/account/google/disconnect',
  'GET /api/settings/sessions',
  'POST /api/settings/sessions/revoke-others',
  'DELETE /api/settings/sessions/:id',
  'GET /api/settings/providers',
  'GET /api/settings/credentials',
  'PUT|DELETE /api/settings/credentials/:provider',
  'POST /api/settings/credentials/:provider/verify',
  'GET|POST /api/jobs',
  'GET /api/jobs/:id',
  'POST /api/jobs/:id/cancel',
  'POST /api/jobs/:id/retry',
  'POST /api/webhooks/:provider/:jobId/:token',
  'GET /api/infographics/options',
  'GET|POST /api/infographics',
  'GET|DELETE /api/infographics/:id',
  'POST /api/infographics/:id/regenerate',
  'GET /api/infographics/:id/image',
  'GET /api/mcp/info',
  'GET /api/mcp/connections',
  'DELETE /api/mcp/connections/:id',
  'GET /api/mcp/activity',
  'GET /api/oauth/interactions/:uid',
  'POST /api/oauth/interactions/:uid/approve|deny',
  'GET /api/assets/:id/content',
  'DELETE /api/assets/:id',
  'GET /api/branding',
  'GET /api/branding/logo|favicon',
  'GET /api/admin/stats',
  'GET /api/admin/system',
  'GET /api/admin/failures',
  'GET /api/admin/ops-logs',
  'GET|PATCH /api/admin/settings',
  'GET /api/admin/providers',
  'PUT /api/admin/providers/:provider/models',
  'GET /api/admin/infographics',
  'GET /api/admin/mcp/monitor',
  'GET /api/admin/mcp/connections',
  'DELETE /api/admin/mcp/connections/:id',
  'GET|PUT /api/admin/branding',
  'POST|DELETE /api/admin/branding/logo|favicon',
  'POST /api/admin/branding/reset',
  'GET /api/admin/users',
  'GET|PATCH /api/admin/users/:id',
  'POST /api/admin/users/:id/act-as',
  'POST /api/auth/act-as/stop',
  'GET /api/admin/audit-logs',
  'GET /api/admin/jobs',
  'POST /api/admin/jobs/:id/retry|cancel',
];

export function createApiRouter({ env }) {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({ name: 'AI Infographic Studio API', version: pkg.version, endpoints: ENDPOINTS });
  });

  router.use(createHealthRouter({ env }));
  router.use('/branding', createBrandingRouter());
  router.use('/auth', createAuthRouter({ env }));
  router.use('/settings', createSettingsRouter({ env }));
  router.use('/admin', createAdminRouter({ env }));
  router.use('/jobs', createJobRouter({ env }));
  router.use('/webhooks', createWebhookRouter({ env }));
  router.use('/infographics', createInfographicRouter({ env }));
  router.use('/assets', createAssetRouter({ env }));
  router.use('/mcp', createMcpRouter());
  router.use('/oauth', createConsentRouter({ env }));

  return router;
}
