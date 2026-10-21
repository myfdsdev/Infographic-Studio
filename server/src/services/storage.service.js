// File storage for uploaded and approved images.
//
// Files are private: nothing is served statically or from a public bucket URL.
// They are read back only through authenticated routes that check ownership
// (GET /api/assets/:id/content), and sent to providers only by the server.
//
// Drivers:
//   local  files under STORAGE_LOCAL_DIR (development; refused in production
//          by env validation)
//   s3     any S3-compatible bucket (AWS S3, Cloudflare R2, MinIO, ...),
//          using the official AWS SDK. Objects are written without any public
//          ACL; the bucket itself should not be public.
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import { getStorageConfig } from '../config/storage.js';
import { AppError } from '../utils/errors.js';

const KEY_PATTERN = /^[a-z0-9][a-z0-9/_.-]{0,400}$/;

function config() {
  return getStorageConfig(env);
}

function assertKey(key) {
  if (!KEY_PATTERN.test(key) || key.includes('..') || key.includes('//')) {
    throw new AppError('Invalid storage key', { statusCode: 500, code: 'BAD_STORAGE_KEY' });
  }
  return key;
}

function localPath(key) {
  assertKey(key);
  const root = path.resolve(config().directory);
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) {
    throw new AppError('Invalid storage key', { statusCode: 500, code: 'BAD_STORAGE_KEY' });
  }
  return full;
}

// ---------------------------------------------------------------- S3

let s3Client = null;
let s3ClientKey = '';

function s3() {
  const { endpoint, region, credentials } = config();
  const cacheKey = `${endpoint}|${region}|${credentials.accessKeyId}`;
  if (!s3Client || s3ClientKey !== cacheKey) {
    s3Client = new S3Client({
      region: region || 'auto',
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      credentials,
      // Only send checksums when an operation requires them: some
      // S3-compatible services (older R2, MinIO setups) reject the newer
      // default checksum headers.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      maxAttempts: 3,
    });
    s3ClientKey = cacheKey;
  }
  return s3Client;
}

function bucket() {
  return config().bucket;
}

function isNotFound(error) {
  return error?.name === 'NoSuchKey' || error?.name === 'NotFound' || error?.$metadata?.httpStatusCode === 404;
}

/** Storage failures never leak bucket names, keys or credentials to clients. */
function storageError(error, action) {
  const wrapped = new AppError(`File storage is unavailable (${action} failed). Try again in a minute.`, {
    statusCode: 503,
    code: 'STORAGE_UNAVAILABLE',
  });
  wrapped.cause = error;
  return wrapped;
}

// ---------------------------------------------------------------- bucket ownership
//
// The app must not share storage with another application. Before the first
// write (and in readiness) the bucket's top level is listed: anything other
// than the app's own folder means the bucket belongs to something else, and
// writes are refused. Folder names are never returned to clients.

const OWNERSHIP_TTL_MS = 5 * 60 * 1000;
let ownership = { at: 0, result: null };

function ownFolders() {
  const prefix = config().keyPrefix;
  return new Set(prefix ? [prefix] : ['users/', 'infographic-studio-selftest/']);
}

/** Folder the live storage check writes its temporary file into. */
export function selfTestFolder() {
  const prefix = config().keyPrefix;
  return prefix ? `${prefix}selftest/` : 'infographic-studio-selftest/';
}

// With a key prefix, the app may only ever write or delete inside it. This is
// what keeps another application's files in a shared bucket untouchable.
function assertInsidePrefix(key) {
  const prefix = config().keyPrefix;
  if (prefix && !key.startsWith(prefix)) {
    throw new AppError('Refusing to touch a file outside the app’s storage folder', {
      statusCode: 500,
      code: 'STORAGE_KEY_OUTSIDE_PREFIX',
    });
  }
}

export async function bucketOwnership({ force = false } = {}) {
  if (config().driver !== 's3') return { dedicated: true, verified: true };
  if (!force && ownership.result && Date.now() - ownership.at < OWNERSHIP_TTL_MS) return ownership.result;
  let result;
  try {
    const listing = await s3().send(
      new ListObjectsV2Command({ Bucket: bucket(), Delimiter: '/', MaxKeys: 1000 }),
      { abortSignal: AbortSignal.timeout(8000) },
    );
    const allowed = ownFolders();
    const foreign = [
      ...(listing.CommonPrefixes || []).map((entry) => entry.Prefix).filter((folder) => !allowed.has(folder)),
      ...(listing.Contents || []).map((entry) => entry.Key),
    ];
    result = { dedicated: foreign.length === 0, verified: true, foreignEntries: foreign.length };
    if (foreign.length) {
      logger.error(
        { foreignEntries: foreign.length },
        'The storage bucket contains files from another application; the app will not write to it. Use a dedicated bucket.',
      );
    }
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    if (status === 403) {
      // A token without list permission: the bucket cannot be checked.
      result = { dedicated: true, verified: false };
      logger.warn('Could not list the storage bucket to confirm it is dedicated to AI Infographic Studio (no list permission).');
    } else {
      throw storageError(error, 'bucket check');
    }
  }
  ownership = { at: Date.now(), result };
  return result;
}

async function assertWritableBucket() {
  if (env.STORAGE_ALLOW_SHARED_BUCKET) return;
  const result = await bucketOwnership();
  if (!result.dedicated) {
    throw new AppError(
      "File storage is misconfigured: the bucket also holds another application's files, so nothing was saved. Use a bucket dedicated to AI Infographic Studio.",
      { statusCode: 503, code: 'STORAGE_NOT_DEDICATED' },
    );
  }
}

/** Test hook. */
export function __resetStorageState() {
  ownership = { at: 0, result: null };
  s3Client = null;
  s3ClientKey = '';
}

// ---------------------------------------------------------------- API

/** A new random key; never derived from user input. */
export function newStorageKey({ userId, purpose, ext }) {
  const date = new Date().toISOString().slice(0, 7); // yyyy-mm
  const name = crypto.randomBytes(16).toString('hex');
  const prefix = config().keyPrefix || '';
  return assertKey(`${prefix}users/${String(userId)}/${purpose.replace(/_/g, '-')}/${date}/${name}.${ext}`);
}

/** A new random key for an app branding image (logo, favicon). */
export function newBrandingKey({ kind, ext }) {
  const name = crypto.randomBytes(12).toString('hex');
  const prefix = config().keyPrefix || '';
  return assertKey(`${prefix}branding/${kind}-${name}.${ext}`);
}

export function newTemplateCoverKey({ ext }) {
  const name = crypto.randomBytes(12).toString('hex');
  const prefix = config().keyPrefix || '';
  return assertKey(`${prefix}templates/cover-${name}.${ext}`);
}

export function storageDriver() {
  return config().driver;
}

export async function putObject(key, buffer, { contentType = 'application/octet-stream' } = {}) {
  assertKey(key);
  if (config().driver === 's3') {
    assertInsidePrefix(key);
    await assertWritableBucket();
    try {
      await s3().send(
        new PutObjectCommand({
          Bucket: bucket(),
          Key: key,
          Body: buffer,
          ContentType: contentType,
          ContentLength: buffer.length,
          CacheControl: 'private, max-age=0, no-store',
        }),
      );
    } catch (error) {
      throw storageError(error, 'upload');
    }
    return;
  }
  const full = localPath(key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  // Write to a temp name first so a crash never leaves a half-written file.
  const temp = `${full}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(temp, buffer, { flag: 'wx' });
  await fs.rename(temp, full);
}

export async function getObject(key) {
  assertKey(key);
  if (config().driver === 's3') {
    try {
      const result = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
      return Buffer.from(await result.Body.transformToByteArray());
    } catch (error) {
      if (isNotFound(error)) throw Object.assign(new Error('Stored file not found'), { code: 'ENOENT' });
      throw storageError(error, 'read');
    }
  }
  return fs.readFile(localPath(key));
}

/**
 * Stream a stored file, optionally a byte range (inclusive), for players that
 * seek with HTTP Range requests.
 */
export async function openObjectStream(key, { start, end } = {}) {
  assertKey(key);
  const ranged = Number.isInteger(start) && Number.isInteger(end);
  if (config().driver === 's3') {
    try {
      const result = await s3().send(
        new GetObjectCommand({ Bucket: bucket(), Key: key, ...(ranged ? { Range: `bytes=${start}-${end}` } : {}) }),
      );
      return result.Body;
    } catch (error) {
      if (isNotFound(error)) throw Object.assign(new Error('Stored file not found'), { code: 'ENOENT' });
      throw storageError(error, 'read');
    }
  }
  const full = localPath(key);
  await fs.access(full);
  return createReadStream(full, ranged ? { start, end } : undefined);
}

export async function deleteObject(key) {
  assertKey(key);
  if (config().driver === 's3') {
    assertInsidePrefix(key);
    try {
      await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
    } catch (error) {
      if (!isNotFound(error)) throw storageError(error, 'delete');
    }
    return;
  }
  try {
    await fs.unlink(localPath(key));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

export async function objectExists(key) {
  assertKey(key);
  if (config().driver === 's3') {
    try {
      await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw storageError(error, 'check');
    }
  }
  try {
    await fs.access(localPath(key));
    return true;
  } catch {
    return false;
  }
}

/** Readiness: can we reach the bucket with these credentials? (No writes.) */
export async function checkBucket({ timeoutMs = 5000 } = {}) {
  if (config().driver !== 's3') return { ok: true };
  try {
    await s3().send(new HeadBucketCommand({ Bucket: bucket() }), { abortSignal: AbortSignal.timeout(timeoutMs) });
    return { ok: true };
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    const reason =
      status === 403 ? 'access denied (check the key and its bucket permissions)' : status === 404 ? 'bucket not found' : error?.name || 'unreachable';
    return { ok: false, reason };
  }
}
