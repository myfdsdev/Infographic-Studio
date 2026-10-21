// Stored files: generated infographic images, copied from the provider's
// temporary URL into private storage and served to their owner only.
import crypto from 'node:crypto';
import { Asset } from '../models/Asset.js';
import { GenerationJob } from '../models/GenerationJob.js';
import { Infographic } from '../models/Infographic.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import * as storage from './storage.service.js';
import { recordAudit } from './audit.service.js';
import { inspectImage } from '../utils/imageInspect.js';
import { downloadPublicFile, FetchError } from '../utils/safeFetch.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import { isObjectId } from '../utils/sanitize.js';
import { ProviderError } from '../providers/providerRegistry.js';

const ACTIVE = ['queued', 'processing'];
// Reuse a provider copy only while it has comfortably more time left than a
// queued job could wait before submission.
const COPY_MIN_REMAINING_MS = 2 * 60 * 60 * 1000;
const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export function contentUrl(assetId) {
  return `/api/assets/${String(assetId)}/content`;
}

export function toAssetDto(asset) {
  if (!asset) return null;
  return {
    id: String(asset._id),
    purpose: asset.purpose,
    source: asset.source,
    mimeType: asset.mimeType,
    size: asset.size,
    width: asset.width,
    height: asset.height,
    url: contentUrl(asset._id),
    createdAt: asset.createdAt,
  };
}

function safeName(name) {
  const cleaned = String(name || '')
    .replace(/[^\w.\- ]+/g, '')
    .trim()
    .slice(0, 120);
  return cleaned || null;
}

function imageError(error) {
  const status = error.code === 'UNSUPPORTED_FILE_TYPE' ? 415 : 400;
  return new AppError(error.message, { statusCode: status, code: error.code || 'INVALID_IMAGE' });
}

async function saveImage({ userId, purpose, source, buffer, originalName = null, sourceJobId = null, minSide }) {
  let image;
  try {
    image = inspectImage(buffer, { minSide, maxSide: 8000 });
  } catch (error) {
    throw imageError(error);
  }
  const storageKey = storage.newStorageKey({ userId, purpose, ext: image.ext });
  await storage.putObject(storageKey, image.buffer, { contentType: image.mimeType });
  try {
    return await Asset.create({
      userId,
      purpose,
      source,
      storageDriver: storage.storageDriver(),
      storageKey,
      mimeType: image.mimeType,
      size: image.buffer.length,
      width: image.width,
      height: image.height,
      sha256: crypto.createHash('sha256').update(image.buffer).digest('hex'),
      originalName: safeName(originalName),
      sourceJobId,
    });
  } catch (error) {
    await storage.deleteObject(storageKey).catch(() => {});
    throw error;
  }
}

/** Save a finished generated image (already downloaded) as the user's asset. */
export async function storeGeneratedImage(userId, { buffer, purpose, sourceJobId }) {
  return saveImage({ userId, purpose, source: 'generated', buffer, sourceJobId, minSide: 64 });
}

export async function getOwnedAsset(userId, id) {
  if (!isObjectId(id)) throw new NotFoundError('File not found');
  const asset = await Asset.findOne({ _id: id, userId });
  if (!asset) throw new NotFoundError('File not found');
  return asset;
}

export async function openAssetContent(userId, id, { range } = {}) {
  const asset = await getOwnedAsset(userId, id);
  try {
    const stream = await storage.openObjectStream(asset.storageKey, range || {});
    return { asset, stream };
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error({ assetId: String(asset._id), reason: error.message }, 'Stored file is missing');
    throw new AppError('The stored file is missing. Generate or upload it again.', { statusCode: 410, code: 'FILE_MISSING' });
  }
}

async function assetInUse(userId, assetId) {
  const [infographic, job] = await Promise.all([
    Infographic.exists({ userId, 'image.assetId': assetId }),
    GenerationJob.exists({ assetIds: assetId, status: { $in: ACTIVE } }),
  ]);
  return { infographic: Boolean(infographic), job: Boolean(job) };
}

/** Delete an asset the user owns, unless an infographic or a running job still uses it. */
export async function deleteAsset(user, id, req) {
  const asset = await getOwnedAsset(user._id, id);
  const usage = await assetInUse(user._id, asset._id);
  if (usage.infographic) {
    throw new AppError('This image belongs to one of your infographics. Delete the infographic instead.', {
      statusCode: 409,
      code: 'ASSET_IN_USE',
    });
  }
  if (usage.job) {
    throw new AppError('A generation that uses this image is still running. Try again when it has finished.', {
      statusCode: 409,
      code: 'ASSET_IN_USE',
    });
  }
  await storage.deleteObject(asset.storageKey);
  await Asset.deleteOne({ _id: asset._id });
  await recordAudit({ req, actor: user, action: 'asset.deleted', area: 'account', target: { type: 'asset', id: asset._id } });
}

/**
 * Internal removal (infographic deletion). Skips assets that a running job
 * or an infographic still needs.
 */
export async function removeAssetsIfUnused(userId, assetIds) {
  const removed = [];
  for (const assetId of [...new Set(assetIds.filter(Boolean).map(String))]) {
    const usage = await assetInUse(userId, assetId);
    if (usage.infographic || usage.job) continue;
    const asset = await Asset.findOne({ _id: assetId, userId });
    if (!asset) continue;
    await storage.deleteObject(asset.storageKey).catch((error) => {
      logger.warn({ assetId, reason: error.message }, 'Could not delete stored file');
    });
    await Asset.deleteOne({ _id: asset._id });
    removed.push(assetId);
  }
  return removed;
}

/** Delete every file of an account (account deletion). */
export async function removeAllAssetsOf(userId) {
  const assets = await Asset.find({ userId }).select('storageKey').lean();
  for (const asset of assets) {
    await storage.deleteObject(asset.storageKey).catch((error) => {
      logger.warn({ assetId: String(asset._id), reason: error.message }, 'Could not delete stored file');
    });
  }
  await Asset.deleteMany({ userId });
  return assets.length;
}

/**
 * A URL the provider can fetch for this asset. Uses the provider's own file
 * upload (with the owner's key) and reuses a recent copy while it is fresh.
 */
export async function providerUrlFor(asset, { provider, apiKey }) {
  const now = Date.now();
  const fresh = (asset.providerCopies || []).find(
    (copy) => copy.provider === provider.key && new Date(copy.expiresAt).getTime() - now > COPY_MIN_REMAINING_MS,
  );
  if (fresh) return fresh.url;
  const buffer = await storage.getObject(asset.storageKey);
  const fileName = `${String(asset._id)}.${EXTENSIONS[asset.mimeType] || 'bin'}`;
  const copy = await provider.uploadFile(apiKey, { buffer, mimeType: asset.mimeType, fileName });
  const copies = [...(asset.providerCopies || []).filter((c) => new Date(c.expiresAt).getTime() > now), { provider: provider.key, ...copy }].slice(-3);
  await Asset.updateOne({ _id: asset._id }, { $set: { providerCopies: copies } });
  return copy.url;
}

/**
 * Download a generated result. Tries the result URL directly; if the CDN
 * refuses, asks the provider for a fresh download link (Kie.ai: 20 minutes).
 */
export async function downloadGeneratedFile(url, { provider, apiKey, maxMb = env.ASSET_DOWNLOAD_MAX_MB }) {
  const maxBytes = maxMb * 1024 * 1024;
  try {
    return await downloadPublicFile(url, { maxBytes });
  } catch (error) {
    const refused = error instanceof FetchError && [401, 403, 404, 410].includes(error.status);
    if (!refused || !apiKey) throw error;
  }
  const fresh = await provider.getDownloadUrl(apiKey, url);
  return downloadPublicFile(fresh, { maxBytes });
}

export function describeDownloadError(error) {
  if (error instanceof ProviderError && error.kind === 'auth') {
    return new AppError('Kie.ai rejected your API key while fetching the image. Replace the key in API settings.', {
      statusCode: 400,
      code: 'PROVIDER_KEY_REJECTED',
    });
  }
  if (error instanceof AppError) return error;
  if (error instanceof FetchError && error.code === 'RESPONSE_TOO_LARGE') {
    return new AppError(`The generated file is larger than ${env.ASSET_DOWNLOAD_MAX_MB} MB.`, { statusCode: 502, code: 'RESULT_TOO_LARGE' });
  }
  return new AppError(
    'Could not fetch the generated image from the provider. If it keeps failing the file may have expired; generate the infographic again.',
    { statusCode: 502, code: 'RESULT_DOWNLOAD_FAILED' },
  );
}

/**
 * Remove generated images nothing points at any more (for example when two
 * workers raced to save the same result), after an hour.
 */
export async function cleanupOrphanAssets({ generatedAfterMs = 60 * 60 * 1000 } = {}) {
  const candidates = await Asset.find({ purpose: 'infographic_image', createdAt: { $lt: new Date(Date.now() - generatedAfterMs) } })
    .select('userId')
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  if (!candidates.length) return 0;
  const used = new Set(
    (await Infographic.find({ 'image.assetId': { $in: candidates.map((asset) => asset._id) } }).select('image.assetId').lean()).map((item) =>
      String(item.image.assetId),
    ),
  );
  let removed = 0;
  for (const asset of candidates.filter((candidate) => !used.has(String(candidate._id)))) {
    removed += (await removeAssetsIfUnused(asset.userId, [asset._id])).length;
  }
  return removed;
}
