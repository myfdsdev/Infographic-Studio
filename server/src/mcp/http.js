// HTTP wiring for the MCP server and its OAuth authorization server.
// Mounted before the app's own CORS and JSON body parsing:
//
//   GET  /.well-known/oauth-protected-resource[/mcp]  RFC 9728 metadata
//   GET  /.well-known/oauth-authorization-server      RFC 8414 (same document as below)
//   GET  /.well-known/openid-configuration            oidc-provider discovery
//   *    /oauth/*                                      authorize, token, register, revoke, jwks
//   POST /mcp                                         Streamable HTTP, Bearer token required
//
// These endpoints are called by AI apps (often server to server, sometimes
// from a browser), never with the user's cookies, so CORS is open without
// credentials. The browser session is only used by the consent page, through
// the normal /api routes.
import crypto from 'node:crypto';
import cors from 'cors';
import mongoose from 'mongoose';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { requireBearerAuth, localhostHostValidation } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/server';
import { getOAuthProvider } from './oauthServer.js';
import { tokenVerifier } from './tokenVerifier.js';
import { createStudioMcpHandler } from './server.js';
import { SCOPE_IDS } from './scopes.js';
import { clientIp, userAgentOf } from '../utils/sanitize.js';
import { mcpAllowed } from '../services/platformSettings.service.js';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const PRM_PATHS = ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'];

function oauthError(res, status, error, description) {
  res.status(status).json({ error, error_description: description });
}

/** The administrator can turn AI-app access off (and maintenance mode does too). */
async function platformGate(_req, res, next) {
  if (await mcpAllowed()) return next();
  return oauthError(res, 503, 'temporarily_unavailable', 'AI app access to AI Infographic Studio is turned off by the administrator right now.');
}

function databaseReady(_req, res, next) {
  if (mongoose.connection.readyState === 1) return next();
  return oauthError(res, 503, 'temporarily_unavailable', 'AI Infographic Studio is starting up. Try again shortly.');
}

function limiter({ windowMs, limit, key }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: key || ((req) => ipKeyGenerator(req.ip || '')),
    handler: (_req, res) => oauthError(res, 429, 'too_many_requests', 'Too many requests. Wait a minute and try again.'),
  });
}

/**
 * A client that asks for none of the MCP scopes (no scope parameter, or only
 * openid/offline_access) is offered all of them; the user still chooses on
 * the consent page. Without this the request would end with nothing granted.
 */
export function withDefaultScopes(url) {
  const parsed = new URL(url, 'http://placeholder');
  const requested = (parsed.searchParams.get('scope') || '').split(' ').filter(Boolean);
  if (requested.some((scope) => SCOPE_IDS.includes(scope))) return url;
  parsed.searchParams.set('scope', [...requested, ...SCOPE_IDS].join(' '));
  return `${parsed.pathname}${parsed.search}`;
}

export function protectedResourceMetadata(env) {
  return {
    resource: env.mcpResourceUrl,
    authorization_servers: [env.oauthIssuer],
    scopes_supported: [...SCOPE_IDS],
    bearer_methods_supported: ['header'],
    resource_name: 'AI Infographic Studio',
    resource_documentation: new URL('/connect', env.CLIENT_URL).toString(),
  };
}

export function mountMcp(app, { env, logger }) {
  if (!env.MCP_ENABLED) return;

  const openCors = cors({
    origin: '*',
    credentials: false,
    exposedHeaders: ['WWW-Authenticate', 'Mcp-Session-Id', 'Mcp-Protocol-Version'],
    maxAge: 600,
  });

  // ---- discovery
  const prm = protectedResourceMetadata(env);
  app.options(PRM_PATHS, openCors);
  app.get(PRM_PATHS, openCors, (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json(prm);
  });

  // ---- authorization server (oidc-provider)
  app.use('/oauth/register', limiter({ windowMs: 60 * 60 * 1000, limit: 30 }));
  app.use('/oauth/token', limiter({ windowMs: 60 * 1000, limit: 60 }));
  app.use('/oauth/authorize', limiter({ windowMs: 60 * 1000, limit: 60 }));
  let callback = null;
  const issuer = new URL(env.oauthIssuer);
  app.use(async (req, res, next) => {
    const path = req.path;
    const alias = path === '/.well-known/oauth-authorization-server';
    if (!alias && path !== '/.well-known/openid-configuration' && !path.startsWith('/oauth/')) return next();
    if (mongoose.connection.readyState !== 1) return databaseReady(req, res, next);
    try {
      if (!callback) callback = (await getOAuthProvider()).callback();
      if (alias) req.url = req.url.replace('/.well-known/oauth-authorization-server', '/.well-known/openid-configuration');
      if (req.method === 'GET' && path === '/oauth/authorize') req.url = withDefaultScopes(req.url);
      // Every endpoint URL the authorization server prints is based on the
      // public SERVER_URL, whatever host or proxy the request came through.
      req.headers['x-forwarded-host'] = issuer.host;
      req.headers['x-forwarded-proto'] = issuer.protocol.slice(0, -1);
      return callback(req, res);
    } catch (error) {
      logger.error({ reason: error.message }, 'OAuth server unavailable');
      return oauthError(res, 503, 'temporarily_unavailable', 'The authorization server is not available right now.');
    }
  });

  // ---- MCP endpoint
  const node = toNodeHandler(createStudioMcpHandler(), {
    maxRequestBodySize: 1024 * 1024,
    onerror: (error) => logger.error({ reason: error.message }, 'MCP adapter error'),
  });
  const bearer = requireBearerAuth({
    verifier: tokenVerifier,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(env.mcpResourceUrl)),
    expectedResource: new URL(env.mcpResourceUrl),
  });
  const mcpLimiter = limiter({
    windowMs: 60 * 1000,
    limit: env.MCP_RATE_LIMIT_PER_MINUTE,
    key: (req) => {
      const header = String(req.headers.authorization || '');
      return header ? `token:${crypto.createHash('sha256').update(header).digest('base64url')}` : `ip:${ipKeyGenerator(req.ip || '')}`;
    },
  });
  // DNS-rebinding protection matters when the server listens on a loopback
  // name a web page could resolve to; public hosts are protected by the
  // bearer token itself.
  const hostCheck = LOOPBACK_HOSTS.has(new URL(env.mcpResourceUrl).hostname) ? localhostHostValidation() : (_req, _res, next) => next();
  const withRequestMeta = (req, _res, next) => {
    req.auth = { ...req.auth, extra: { ...(req.auth?.extra || {}), ip: clientIp(req), userAgent: userAgentOf(req) } };
    next();
  };

  app.options('/mcp', openCors);
  app.all('/mcp', openCors, hostCheck, mcpLimiter, databaseReady, platformGate, bearer, withRequestMeta, (req, res) => {
    node(req, res);
  });
}
