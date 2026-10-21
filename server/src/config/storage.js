// Object storage configuration.
//
// Phase 1 only resolves and verifies the configuration; the upload service that
// writes files arrives with the uploads phase. Keeping this here lets the
// readiness endpoint report whether storage is usable before any feature
// depends on it.
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';

export function getStorageConfig(env) {
  if (env.STORAGE_DRIVER === 's3') {
    return {
      driver: 's3',
      keyPrefix: env.STORAGE_KEY_PREFIX || '',
      endpoint: env.S3_ENDPOINT || null,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      publicBaseUrl: env.S3_PUBLIC_BASE_URL,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    };
  }
  return {
    driver: 'local',
    keyPrefix: env.STORAGE_KEY_PREFIX || '',
    directory: env.storageLocalDir,
    publicBaseUrl: `${env.SERVER_URL.replace(/\/$/, '')}/storage`,
  };
}

/** Create the local storage directory when using the local driver. */
export async function ensureStorage(env, logger) {
  const config = getStorageConfig(env);
  if (config.driver === 'local') {
    await fs.mkdir(config.directory, { recursive: true });
    logger?.info({ directory: config.directory }, 'Local storage directory ready');
  }
  return config;
}

/** Snapshot used by the readiness endpoint. Never includes credentials. */
export async function getStorageStatus(env) {
  const config = getStorageConfig(env);
  if (config.driver === 's3') {
    const configured = Boolean(
      config.bucket && config.credentials.accessKeyId && config.credentials.secretAccessKey,
    );
    return {
      driver: 's3',
      configured,
      bucket: config.bucket || null,
      endpoint: config.endpoint,
      keyPrefix: config.keyPrefix || null,
    };
  }
  let writable = false;
  try {
    await fs.access(config.directory, fsConstants.W_OK);
    writable = true;
  } catch {
    writable = false;
  }
  return {
    driver: 'local',
    configured: true,
    directory: config.directory,
    writable,
  };
}
