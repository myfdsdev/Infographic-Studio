// Process entry point: validate environment, start the HTTP server, connect to
// MongoDB (with retries), ensure indexes, verify email delivery, and shut down
// cleanly on signals.
import http from 'node:http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { ensureStorage } from './config/storage.js';
import { ensureIndexes } from './models/index.js';
import { verifyEmailTransport, getEmailStatus } from './services/email.service.js';
import { createWorker } from './jobs/worker.js';

const app = createApp({ env, logger });
const worker = env.WORKER_ENABLED ? createWorker({ env, logger }) : null;
let workerStarted = false;
const server = http.createServer(app);

server.listen(env.PORT, env.HOST, () => {
  const displayHost = env.HOST === '0.0.0.0' || env.HOST === '::' ? 'localhost' : env.HOST;
  logger.info(
    { port: env.PORT, host: env.HOST, env: env.NODE_ENV, clientUrl: env.CLIENT_URL },
    `AI Infographic Studio API listening on http://${displayHost}:${env.PORT}`,
  );
});

server.on('error', (err) => {
  logger.fatal({ err }, 'HTTP server failed to start');
  process.exit(1);
});

ensureStorage(env, logger).catch((err) => logger.error({ err }, 'Storage initialisation failed'));

// Non-blocking: the API stays up and /api/ready reports the real state while
// the connection is retried in the background. Indexes are ensured each time
// a connection opens (idempotent and non-destructive).
connectDatabase({
  env,
  logger,
  retry: true,
  onConnected: async () => {
    const models = await ensureIndexes();
    logger.info({ database: env.databaseName, models }, 'Database indexes ensured');
    // The worker starts once; on later reconnects it simply resumes ticking.
    if (worker && !workerStarted) {
      workerStarted = true;
      await worker.start();
    }
  },
});
if (!worker) logger.warn('WORKER_ENABLED=false: generation jobs will queue but not run in this process');

verifyEmailTransport().then((status) => {
  if (!status.deliversToInbox) {
    logger.warn({ provider: status.provider }, status.note || 'Email delivery is not configured');
  }
});
if (getEmailStatus().provider === 'console') {
  logger.warn('EMAIL_PROVIDER=console: password-reset links are written to this log, not emailed.');
}

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  const forceExit = setTimeout(() => {
    logger.error('Forced exit after shutdown timeout');
    process.exit(1);
  }, 10000);
  forceExit.unref();

  server.close(async () => {
    try {
      // Let in-flight job steps finish (bounded); anything cut off is
      // recovered on the next start from its stored phase.
      if (worker) await worker.stop({ timeoutMs: 8000 });
      await disconnectDatabase();
    } catch (err) {
      logger.error({ err }, 'Error while disconnecting MongoDB');
    }
    logger.info('Shutdown complete');
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  shutdown('uncaughtException');
});
