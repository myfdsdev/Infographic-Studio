// Express application factory. Kept separate from server.js so tests can build
// the app without opening a port.
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { createApiRouter } from './routes/index.js';
import { createApiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { mountMcp } from './mcp/http.js';

/** Replace the capability token in /webhooks/:provider/:jobId/:token URLs. */
export function maskWebhookToken(url) {
  return String(url || '').replace(/(\/webhooks\/[^/]+\/[^/]+\/)[^/?#]+/, '$1***');
}

function buildCorsOptions(env) {
  const allowed = new Set(
    [env.CLIENT_URL, env.SERVER_URL, ...env.CORS_ORIGINS].map((origin) => origin.replace(/\/$/, '')),
  );
  return {
    credentials: true,
    origin(origin, callback) {
      // Same-origin requests and server-to-server calls carry no Origin header.
      // Browsers always send Origin on cross-site POST/PATCH/DELETE, so this
      // allow-list (together with SameSite cookies) is the CSRF defence.
      if (!origin || allowed.has(origin.replace(/\/$/, ''))) return callback(null, true);
      const err = new Error(`Origin ${origin} is not allowed`);
      err.code = 'CORS_NOT_ALLOWED';
      return callback(err);
    },
  };
}

/**
 * Content Security Policy for the built client (SERVE_CLIENT=true). Scripts
 * only from this origin. Images and audio may also come from https URLs:
 * provider preview images before they are saved, and the voice samples on
 * Kie.ai's CDN. blob: is used for local photo previews before upload.
 */
function clientCsp(env) {
  return {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    scriptSrc: ["'self'"],
    scriptSrcAttr: ["'none'"],
    styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
    fontSrc: ["'self'", 'https:', 'data:'],
    imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
    mediaSrc: ["'self'", 'blob:', 'https:'],
    connectSrc: ["'self'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'self'"],
    formAction: ["'self'"],
    upgradeInsecureRequests: env.SERVER_URL.startsWith('https://') ? [] : null,
  };
}

export function createApp({ env, logger }) {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  // Request logging and ids come first so every later failure (CORS, body
  // parsing, routing) is logged with a request id.
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.headers['x-request-id'] || randomUUID(),
      autoLogging: { ignore: (req) => req.url === '/api/health' || req.url === '/api/ready' },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      serializers: {
        // Webhook URLs carry a capability token; never write it to logs.
        req: (req) => ({ id: req.id, method: req.method, url: maskWebhookToken(req.url) }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  app.use(
    helmet({
      // The API serves JSON; the client's CSP is added below, only for its pages.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  // MCP endpoint and OAuth server: before the app's CORS allow-list and body
  // parsers (AI apps call them without cookies; they parse their own bodies).
  mountMcp(app, { env, logger });

  app.use(cors(buildCorsOptions(env)));
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', createApiLimiter(env), createApiRouter({ env }));

  // Optional: serve the built React client from the same process.
  if (env.SERVE_CLIENT) {
    const clientDist = path.resolve(env.serverRoot, '..', 'client', 'dist');
    const indexHtml = path.join(clientDist, 'index.html');
    if (fs.existsSync(indexHtml)) {
      app.use(helmet.contentSecurityPolicy({ directives: clientCsp(env) }));
      app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
      app.use((req, res, next) => {
        if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
        if (!req.accepts('html')) return next();
        return res.sendFile(indexHtml);
      });
      logger.info({ clientDist }, 'Serving built client');
    } else {
      logger.warn(
        { clientDist },
        'SERVE_CLIENT is true but client/dist/index.html does not exist; run "npm run build" first',
      );
    }
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
