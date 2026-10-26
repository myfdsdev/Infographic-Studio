// Platform controls an administrator can change at runtime: who may use the
// app (sign-ups, maintenance), whether new generation and AI-app access are
// allowed, worker and per-user concurrency, what an infographic costs in
// platform credits, and which provider models are offered. Stored in AppSettings ("platform"), cached briefly in memory so the
// hot paths (every request, every job) do not hit the database each time.
// Environment variables give the defaults until an administrator saves.
import { z } from 'zod';
import { env } from '../config/env.js';
import { AppSettings } from '../models/AppSettings.js';
import { recordAudit } from './audit.service.js';
import { AppError, ServiceUnavailableError } from '../utils/errors.js';

const KEY = 'platform';
const CACHE_MS = 5000;

export const platformSettingsBody = z.strictObject({
  access: z
    .strictObject({
      signupEnabled: z.boolean().optional(),
      maintenanceMode: z.boolean().optional(),
      maintenanceMessage: z.string().trim().max(300).optional(),
      generationEnabled: z.boolean().optional(),
      generationPausedMessage: z.string().trim().max(300).optional(),
      mcpEnabled: z.boolean().optional(),
    })
    .optional(),
  limits: z
    .strictObject({
      userConcurrency: z.number().int().min(1).max(20).optional(),
      workerConcurrency: z.number().int().min(1).max(50).optional(),
    })
    .optional(),
  credits: z
    .strictObject({
      perInfographic: z.number().int().min(1).max(10000).optional(),
    })
    .optional(),
});

export const DEFAULT_CREDITS_PER_INFOGRAPHIC = 10;

export function defaultPlatformSettings() {
  return {
    access: {
      signupEnabled: env.SIGNUP_ENABLED,
      maintenanceMode: false,
      maintenanceMessage: 'AI Infographic Studio is under maintenance. Please try again later.',
      generationEnabled: true,
      generationPausedMessage: 'New generations are paused by the administrator. Please try again later.',
      mcpEnabled: true,
    },
    limits: {
      userConcurrency: env.JOB_USER_CONCURRENCY,
      workerConcurrency: env.WORKER_CONCURRENCY,
    },
    credits: { perInfographic: DEFAULT_CREDITS_PER_INFOGRAPHIC },
    models: { disabled: [] },
  };
}

function merge(stored) {
  const defaults = defaultPlatformSettings();
  return {
    access: { ...defaults.access, ...(stored?.access || {}) },
    limits: { ...defaults.limits, ...(stored?.limits || {}) },
    credits: { ...defaults.credits, ...(stored?.credits || {}) },
    models: { disabled: Array.isArray(stored?.models?.disabled) ? [...stored.models.disabled] : [] },
    updatedAt: stored?.updatedAt || null,
    updatedBy: stored?.updatedBy || null,
  };
}

let cache = null;
let cacheAt = 0;

export async function getPlatformSettings({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cacheAt < CACHE_MS) return cache;
  try {
    const doc = await AppSettings.findOne({ key: KEY }).lean();
    cache = merge(doc?.value);
  } catch {
    // Database briefly unavailable: keep the last known values (or defaults).
    cache = cache || merge(null);
  }
  cacheAt = Date.now();
  return cache;
}

/** Synchronous best-known values for code that cannot await (worker loop). */
export function cachedPlatformSettings() {
  return cache || merge(null);
}

export function __resetPlatformSettingsCache() {
  cache = null;
  cacheAt = 0;
}

async function save(next, actor, req, { action, summary, metadata }) {
  const value = {
    access: next.access,
    limits: next.limits,
    credits: next.credits,
    models: next.models,
    updatedAt: new Date(),
    updatedBy: actor?.email || null,
  };
  await AppSettings.updateOne({ key: KEY }, { $set: { value, updatedBy: actor?.email || null } }, { upsert: true });
  __resetPlatformSettingsCache();
  await recordAudit({ req, actor, action, area: 'admin', target: { type: 'settings', id: KEY }, summary, metadata });
  return getPlatformSettings({ fresh: true });
}

function diff(before, after) {
  const changes = {};
  for (const section of ['access', 'limits', 'credits']) {
    for (const [key, value] of Object.entries(after[section])) {
      if (before[section][key] !== value) changes[`${section}.${key}`] = { from: before[section][key], to: value };
    }
  }
  return changes;
}

export async function updatePlatformSettings(actor, body, req) {
  const current = await getPlatformSettings({ fresh: true });
  const next = {
    access: { ...current.access, ...(body.access || {}) },
    limits: { ...current.limits, ...(body.limits || {}) },
    credits: { ...current.credits, ...(body.credits || {}) },
    models: current.models,
  };
  const changes = diff(current, next);
  if (Object.keys(changes).length === 0) return current;
  return save(next, actor, req, {
    action: 'admin.settings_updated',
    summary: `Platform settings changed: ${Object.keys(changes).join(', ')}`.slice(0, 500),
    metadata: { changes },
  });
}

export async function setModelEnabled(actor, modelId, enabled, req) {
  const current = await getPlatformSettings({ fresh: true });
  const disabled = new Set(current.models.disabled);
  if (enabled) disabled.delete(modelId);
  else disabled.add(modelId);
  return save({ ...current, models: { disabled: [...disabled].sort() } }, actor, req, {
    action: enabled ? 'admin.model_enabled' : 'admin.model_disabled',
    summary: `${enabled ? 'Enabled' : 'Disabled'} model ${modelId}`,
    metadata: { model: modelId },
  });
}

// ---------------------------------------------------------------- checks

export async function isModelEnabled(modelId) {
  const settings = await getPlatformSettings();
  return !settings.models.disabled.includes(modelId);
}

export async function assertModelEnabled(modelId) {
  if (!(await isModelEnabled(modelId))) {
    throw new AppError(`The model ${modelId} is turned off by the administrator. Choose another model.`, {
      statusCode: 400,
      code: 'MODEL_DISABLED',
    });
  }
}

/** New paid generation (jobs, previews, videos, retries) is allowed. */
export async function assertGenerationAllowed() {
  const settings = await getPlatformSettings();
  if (!settings.access.generationEnabled) {
    throw new AppError(settings.access.generationPausedMessage, { statusCode: 503, code: 'GENERATION_PAUSED' });
  }
}

export async function assertSignupAllowed() {
  const settings = await getPlatformSettings();
  if (!settings.access.signupEnabled) {
    throw new AppError('New sign-ups are closed. Ask the administrator for access.', { statusCode: 403, code: 'SIGNUP_DISABLED' });
  }
}

/** Maintenance mode lets administrators in and keeps everyone else out. */
export async function assertAppAccess(user) {
  if (user?.role === 'admin') return;
  const settings = await getPlatformSettings();
  if (settings.access.maintenanceMode) {
    const error = new ServiceUnavailableError(settings.access.maintenanceMessage);
    error.code = 'MAINTENANCE';
    throw error;
  }
}

export async function mcpAllowed() {
  const settings = await getPlatformSettings();
  return settings.access.mcpEnabled && !settings.access.maintenanceMode;
}
