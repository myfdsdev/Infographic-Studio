// Liveness and readiness endpoints.
//
//   GET /api/health  -> 200 while the process is up (liveness probe)
//   GET /api/ready   -> 200 when every REQUIRED dependency is available,
//                       otherwise 503 with the failing checks listed.
//
// Email delivery is reported but not required: the API works without it,
// password-reset emails do not. The report says so honestly.
import { Router } from 'express';
import { getDatabaseStatus, pingDatabase } from '../config/database.js';
import { getStorageStatus } from '../config/storage.js';
import { checkBucket, bucketOwnership } from '../services/storage.service.js';
import { getEmailStatus } from '../services/email.service.js';
import pkg from '../../package.json' with { type: 'json' };

export function createHealthRouter({ env }) {
  const router = Router();
  const startedAt = new Date();

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'infographic-studio-api',
      version: pkg.version,
      environment: env.NODE_ENV,
      uptimeSeconds: Math.round(process.uptime()),
      startedAt: startedAt.toISOString(),
      timestamp: new Date().toISOString(),
    });
  });

  router.get('/ready', async (_req, res) => {
    const [database, storage, latencyMs, bucket] = await Promise.all([
      Promise.resolve(getDatabaseStatus()),
      getStorageStatus(env),
      pingDatabase(),
      env.STORAGE_DRIVER === 's3'
        ? checkBucket().then(async (reach) => {
            if (!reach.ok) return { reachable: false, ok: false, reason: reach.reason };
            try {
              const own = await bucketOwnership();
              const allowed = own.dedicated || env.STORAGE_ALLOW_SHARED_BUCKET;
              return {
                reachable: true,
                dedicated: own.dedicated,
                dedicatedVerified: own.verified,
                ok: allowed,
                ...(allowed ? {} : { reason: 'the bucket also holds files from another application; use a dedicated bucket' }),
              };
            } catch {
              return { reachable: true, ok: false, reason: 'bucket check failed' };
            }
          })
        : Promise.resolve(null),
    ]);
    const email = getEmailStatus();

    const checks = {
      database: {
        ...database,
        required: true,
        ok: database.connected && latencyMs !== null,
        latencyMs: latencyMs === null ? null : Math.round(latencyMs * 100) / 100,
      },
      storage: {
        ...storage,
        required: true,
        ...(bucket
          ? {
              reachable: bucket.reachable,
              ...(bucket.dedicated !== undefined ? { dedicated: bucket.dedicated, dedicatedVerified: bucket.dedicatedVerified } : {}),
              ...(bucket.ok ? {} : { lastError: bucket.reason }),
            }
          : {}),
        ok: storage.driver === 'local' ? storage.writable : storage.configured && Boolean(bucket?.ok),
      },
      email: {
        ...email,
        required: false,
        ok: email.deliversToInbox,
      },
    };

    const ready = Object.values(checks).every((check) => check.ok || check.required === false);
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      service: 'infographic-studio-api',
      version: pkg.version,
      timestamp: new Date().toISOString(),
      checks,
    });
  });

  return router;
}
