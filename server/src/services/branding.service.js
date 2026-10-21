// App branding: name, tagline, accent colour, logo and favicon. Stored in
// AppSettings ("branding"); uploaded images live in storage under branding/.
// The defaults are "AI Infographic Studio" with the supplied logo and favicon,
// which the client ships in /branding/ and uses whenever no custom image is
// set. Everyone can read the branding (the sign-in page needs it).
import { z } from 'zod';
import { AppSettings } from '../models/AppSettings.js';
import * as storage from './storage.service.js';
import { recordAudit } from './audit.service.js';
import { inspectImage } from '../utils/imageInspect.js';
import { AppError, NotFoundError } from '../utils/errors.js';

const KEY = 'branding';
const CACHE_MS = 5000;

export const BRANDING_DEFAULTS = Object.freeze({
  appName: 'AI Infographic Studio',
  tagline: 'Turn any topic into a clear, professional infographic',
  accentColor: '#7665e8',
});

export const IMAGE_RULES = Object.freeze({
  logo: { maxBytes: 2 * 1024 * 1024, minSide: 32, maxSide: 4096, square: false, label: 'Logo' },
  favicon: { maxBytes: 512 * 1024, minSide: 16, maxSide: 1024, square: true, label: 'Favicon' },
});

export const brandingBody = z.strictObject({
  appName: z.string().trim().min(2, 'The app name needs at least 2 characters').max(40, 'Keep the app name to 40 characters').optional(),
  tagline: z.string().trim().max(120, 'Keep the tagline to 120 characters').optional(),
  accentColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #ffffff')
    .transform((value) => value.toLowerCase())
    .optional(),
});

let cache = null;
let cacheAt = 0;

function merge(stored) {
  return {
    appName: stored?.appName || BRANDING_DEFAULTS.appName,
    tagline: stored?.tagline ?? BRANDING_DEFAULTS.tagline,
    accentColor: stored?.accentColor || BRANDING_DEFAULTS.accentColor,
    logo: stored?.logo || null,
    favicon: stored?.favicon || null,
    version: stored?.version || 0,
    updatedAt: stored?.updatedAt || null,
    updatedBy: stored?.updatedBy || null,
  };
}

export async function getBranding({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cacheAt < CACHE_MS) return cache;
  try {
    const doc = await AppSettings.findOne({ key: KEY }).lean();
    cache = merge(doc?.value);
  } catch {
    cache = cache || merge(null);
  }
  cacheAt = Date.now();
  return cache;
}

export function __resetBrandingCache() {
  cache = null;
  cacheAt = 0;
}

/** What every visitor gets. Image paths are relative to the API base (/api). */
export function toPublicBranding(branding) {
  return {
    appName: branding.appName,
    tagline: branding.tagline,
    accentColor: branding.accentColor,
    logoPath: branding.logo ? `/branding/logo?v=${branding.version}` : null,
    faviconPath: branding.favicon ? `/branding/favicon?v=${branding.version}` : null,
    customLogo: Boolean(branding.logo),
    customFavicon: Boolean(branding.favicon),
    version: branding.version,
  };
}

export function toAdminBranding(branding) {
  return {
    ...toPublicBranding(branding),
    defaults: BRANDING_DEFAULTS,
    logo: branding.logo ? { width: branding.logo.width, height: branding.logo.height, size: branding.logo.size, mimeType: branding.logo.mimeType } : null,
    favicon: branding.favicon
      ? { width: branding.favicon.width, height: branding.favicon.height, size: branding.favicon.size, mimeType: branding.favicon.mimeType }
      : null,
    updatedAt: branding.updatedAt,
    updatedBy: branding.updatedBy,
  };
}

async function save(next, actor) {
  const value = { ...next, version: (next.version || 0) + 1, updatedAt: new Date(), updatedBy: actor?.email || null };
  delete value.defaults;
  await AppSettings.updateOne({ key: KEY }, { $set: { value, updatedBy: actor?.email || null } }, { upsert: true });
  __resetBrandingCache();
  return getBranding({ fresh: true });
}

export async function updateBranding(actor, body, req) {
  const current = await getBranding({ fresh: true });
  const changes = {};
  for (const field of ['appName', 'tagline', 'accentColor']) {
    if (body[field] !== undefined && body[field] !== current[field]) changes[field] = { from: current[field], to: body[field] };
  }
  if (Object.keys(changes).length === 0) return current;
  const next = await save({ ...current, ...Object.fromEntries(Object.entries(changes).map(([field, change]) => [field, change.to])) }, actor);
  await recordAudit({
    req,
    actor,
    action: 'admin.branding_updated',
    area: 'admin',
    target: { type: 'settings', id: KEY },
    summary: `Branding changed: ${Object.keys(changes).join(', ')}`,
    metadata: { changes },
  });
  return next;
}

export async function setBrandingImage(actor, kind, { buffer }, req) {
  const rules = IMAGE_RULES[kind];
  if (!rules) throw new NotFoundError('Unknown branding image');
  if (buffer.length > rules.maxBytes) {
    throw new AppError(`${rules.label} files can be at most ${Math.round(rules.maxBytes / 1024)} KB.`, { statusCode: 413, code: 'FILE_TOO_LARGE' });
  }
  let image;
  try {
    // PNG, JPEG or WebP only (never SVG, which could carry scripts); metadata removed.
    image = inspectImage(buffer, { minSide: rules.minSide, maxSide: rules.maxSide });
  } catch (error) {
    throw new AppError(error.message, { statusCode: 400, code: error.code || 'UNSUPPORTED_FILE_TYPE' });
  }
  if (rules.square && Math.max(image.width, image.height) / Math.min(image.width, image.height) > 1.25) {
    throw new AppError(`Use a square favicon (it is ${image.width}x${image.height}).`, { statusCode: 400, code: 'FAVICON_NOT_SQUARE' });
  }
  const key = storage.newBrandingKey({ kind, ext: image.ext });
  await storage.putObject(key, image.buffer, { contentType: image.mimeType });
  const current = await getBranding({ fresh: true });
  const previous = current[kind];
  const next = await save({ ...current, [kind]: { key, mimeType: image.mimeType, width: image.width, height: image.height, size: image.buffer.length } }, actor);
  if (previous?.key) await storage.deleteObject(previous.key).catch(() => {});
  await recordAudit({
    req,
    actor,
    action: `admin.branding_${kind}_uploaded`,
    area: 'admin',
    target: { type: 'settings', id: KEY },
    summary: `${rules.label} uploaded (${image.width}x${image.height}, ${image.mimeType})`,
  });
  return next;
}

export async function resetBrandingImage(actor, kind, req) {
  if (!IMAGE_RULES[kind]) throw new NotFoundError('Unknown branding image');
  const current = await getBranding({ fresh: true });
  if (!current[kind]) return current;
  const next = await save({ ...current, [kind]: null }, actor);
  await storage.deleteObject(current[kind].key).catch(() => {});
  await recordAudit({
    req,
    actor,
    action: `admin.branding_${kind}_reset`,
    area: 'admin',
    target: { type: 'settings', id: KEY },
    summary: `${IMAGE_RULES[kind].label} reset to the default`,
  });
  return next;
}

export async function resetBranding(actor, req) {
  const current = await getBranding({ fresh: true });
  for (const kind of ['logo', 'favicon']) {
    if (current[kind]?.key) await storage.deleteObject(current[kind].key).catch(() => {});
  }
  const next = await save({ ...BRANDING_DEFAULTS, logo: null, favicon: null, version: current.version }, actor);
  await recordAudit({ req, actor, action: 'admin.branding_reset', area: 'admin', target: { type: 'settings', id: KEY }, summary: 'Branding reset to the AI Infographic Studio defaults' });
  return next;
}

/** The stored image bytes for the public endpoints. */
export async function brandingImage(kind) {
  const branding = await getBranding();
  const image = branding[kind];
  if (!image) throw new NotFoundError('No custom image is set');
  return { buffer: await storage.getObject(image.key), mimeType: image.mimeType };
}
