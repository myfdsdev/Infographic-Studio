// Structured logging (pino). In development the output is pretty-printed; in
// production it is newline-delimited JSON for log collectors.
import { createRequire } from 'node:module';
import pino from 'pino';
import { env } from './env.js';
import { createOpsLogStream } from './opsLog.js';

const require = createRequire(import.meta.url);

/**
 * Main output (pretty in development, JSON otherwise) plus a copy of warnings
 * and errors for the admin panel's operational log (see opsLog.js). Both
 * receive the already-redacted line.
 */
function destinations(config, usePretty) {
  let main = process.stdout;
  if (usePretty) {
    try {
      const pretty = require('pino-pretty');
      main = pretty({ colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname,service,env' });
    } catch {
      // pino-pretty is a dev dependency; fall back to JSON.
    }
  }
  return pino.multistream([
    { level: config.LOG_LEVEL, stream: main },
    { level: 'warn', stream: createOpsLogStream() },
  ]);
}

export function createLogger(config = env, { destination } = {}) {
  const usePretty = config.isDevelopment && config.LOG_LEVEL !== 'silent';
  const options = {
    level: config.LOG_LEVEL,
    base: { service: 'infographic-studio-api', env: config.NODE_ENV },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.password',
        '*.apiKey',
        '*.api_key',
        '*.token',
        '*.secret',
        'apiKey',
        '*.*.apiKey',
        'encryptedKey',
        '*.encryptedKey',
        '*.authorization',
        '*.headers.authorization',
        '*.Authorization',
      ],
      censor: '[REDACTED]',
    },
  };
  if (config.LOG_LEVEL === 'silent') return pino(options);
  return pino(options, destination || destinations(config, usePretty));
}

export const logger = createLogger();
