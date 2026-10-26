import * as ops from '../services/adminOps.service.js';
import * as platform from '../services/platformSettings.service.js';
import * as branding from '../services/branding.service.js';
import { env } from '../config/env.js';

export async function stats(_req, res) {
  res.json({ stats: await ops.getStats() });
}

export async function system(_req, res) {
  res.json({ system: await ops.systemHealth() });
}

export async function failures(req, res) {
  res.json(await ops.failureSummary(req.validated.query));
}

export async function opsLogs(req, res) {
  res.json(await ops.listOpsLogs(req.validated.query));
}

// ---- settings
function settingsDto(settings) {
  return {
    access: settings.access,
    limits: settings.limits,
    credits: settings.credits,
    disabledModels: settings.models.disabled,
    updatedAt: settings.updatedAt,
    updatedBy: settings.updatedBy,
    // Hard limits from the environment that the panel cannot change.
    environment: {
      mcpEnabled: env.MCP_ENABLED,
      workerEnabled: env.WORKER_ENABLED,
      maxUserConcurrency: 20,
      maxWorkerConcurrency: 50,
    },
  };
}

export async function getSettings(_req, res) {
  res.json({ settings: settingsDto(await platform.getPlatformSettings({ fresh: true })) });
}

export async function updateSettings(req, res) {
  res.json({ settings: settingsDto(await platform.updatePlatformSettings(req.user, req.validated.body, req)) });
}

// ---- providers
export async function providers(_req, res) {
  res.json(await ops.providerOverview());
}

export async function setModel(req, res) {
  const { model, enabled } = req.validated.body;
  res.json(await ops.setProviderModel(req.user, req.validated.params.provider, model, enabled, req));
}

// ---- generations and MCP monitoring
export async function infographics(req, res) {
  res.json(await ops.listAllInfographics(req.validated.query));
}

export async function mcpMonitor(req, res) {
  res.json({ monitor: await ops.mcpMonitor(req.validated.query) });
}

// ---- AI connections
export async function connections(req, res) {
  res.json(await ops.listAllConnections(req.validated.query));
}

export async function revokeConnection(req, res) {
  res.json({ connection: await ops.revokeConnectionAsAdmin(req.user, req.validated.params.id, req) });
}

// ---- branding
export async function getBranding(_req, res) {
  res.json({ branding: branding.toAdminBranding(await branding.getBranding({ fresh: true })) });
}

export async function updateBranding(req, res) {
  res.json({ branding: branding.toAdminBranding(await branding.updateBranding(req.user, req.validated.body, req)) });
}

export async function uploadBrandingImage(req, res) {
  const updated = await branding.setBrandingImage(req.user, req.validated.params.kind, { buffer: req.file.buffer }, req);
  res.status(201).json({ branding: branding.toAdminBranding(updated) });
}

export async function resetBrandingImage(req, res) {
  res.json({ branding: branding.toAdminBranding(await branding.resetBrandingImage(req.user, req.validated.params.kind, req)) });
}

export async function resetBranding(req, res) {
  res.json({ branding: branding.toAdminBranding(await branding.resetBranding(req.user, req)) });
}
