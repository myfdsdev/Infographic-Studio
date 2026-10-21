// OAuth 2.1 authorization server for MCP clients, built on oidc-provider
// (a maintained, certified implementation) rather than hand-written protocol
// code. What it is configured to do:
//
//   - authorization code flow only, PKCE with S256 required for every client
//   - RFC 8707 resource indicators: tokens are issued for exactly one
//     audience, the MCP endpoint (SERVER_URL/mcp), as opaque values stored
//     server-side (hashed, see oauthStore.js)
//   - client registration through Client ID Metadata Documents (fetched with
//     oidc-provider's SSRF-guarded fetch) and, as a fallback, RFC 7591 Dynamic
//     Client Registration
//   - refresh tokens rotated on every use; a reused refresh token revokes the
//     whole grant
//   - RFC 9207 `iss` in authorization responses
//   - no login form of its own: every authorization request is sent to the
//     AI Infographic Studio consent page, where the user's normal web session decides who
//     is signing in and the user approves (or narrows) the scopes each time
import Provider, { interactionPolicy, errors } from 'oidc-provider';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { User } from '../models/User.js';
import { McpConnection } from '../models/McpConnection.js';
import { MongoOAuthAdapter } from './oauthStore.js';
import { loadSigningJwks } from './oauthKeys.js';
import { SCOPE_IDS } from './scopes.js';
import { htmlEscape } from './html.js';

const { Check } = interactionPolicy;

/** Client ID Metadata Document clients use an https URL with a path as their id. */
export function isMetadataDocumentClientId(clientId) {
  return /^https:\/\/[^/?#]+\/[^?#]*$/i.test(String(clientId || ''));
}

export const OAUTH_ROUTES = Object.freeze({
  authorization: '/oauth/authorize',
  token: '/oauth/token',
  registration: '/oauth/register',
  revocation: '/oauth/revoke',
  jwks: '/oauth/jwks',
  end_session: '/oauth/session/end',
  // Disabled features still need distinct paths.
  userinfo: '/oauth/userinfo',
  introspection: '/oauth/introspect',
  pushed_authorization_request: '/oauth/par',
  backchannel_authentication: '/oauth/backchannel',
  code_verification: '/oauth/device',
  device_authorization: '/oauth/device/auth',
  challenge: '/oauth/challenge',
  credential: '/oauth/credential',
});

// The consent page is a client route on CLIENT_URL.
export const CONSENT_PATH = '/connect/approve';

let providerPromise = null;
let cimdFetchOverride = null;

/** Tests only: serve Client ID Metadata Documents without the network. */
export function __setCimdFetch(fn) {
  if (!env.isTest) throw new Error('__setCimdFetch is only available in tests');
  cimdFetchOverride = fn;
}

function cookieKeys() {
  // Derived from SESSION_SECRET, so every API instance signs the same way.
  return [crypto.createHmac('sha256', env.SESSION_SECRET).update('infographic-studio:oauth-cookies:v1').digest('base64url')];
}

function buildPolicy() {
  const policy = interactionPolicy.base();
  // Always ask: the app's web session, not a remembered OAuth session,
  // decides which account is connected, and the user sees every request.
  policy.get('consent').checks.add(
    new Check('owner_approval', 'the account owner approves every authorization', (ctx) =>
      ctx.oidc.result?.consent ? Check.NO_NEED_TO_PROMPT : Check.REQUEST_PROMPT,
    ),
  );
  return policy;
}

/** Client details for the consent page, saved while the request context is available. */
async function rememberInteractionClient(ctx, interaction) {
  const client = ctx.oidc.client;
  const info = {
    clientId: client.clientId,
    clientName: client.clientName || null,
    clientUri: client.clientUri || null,
    redirectUris: client.redirectUris || [],
    registration: isMetadataDocumentClientId(client.clientId) ? 'metadata_document' : 'dynamic',
  };
  const ttl = Math.max(60, (interaction.exp || 0) - Math.floor(Date.now() / 1000));
  await new MongoOAuthAdapter('InteractionClient').upsert(interaction.uid, info, ttl);
}

export async function interactionClient(uid) {
  return new MongoOAuthAdapter('InteractionClient').find(uid);
}

function errorPage(out) {
  const description = out.error_description || 'The authorization request could not be completed.';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Infographic Studio: connection failed</title>
<style>body{margin:0;background:#f8fafc;color:#202338;font:16px/1.5 system-ui,sans-serif;display:grid;min-height:100vh;place-items:center;padding:16px}
main{max-width:480px;border:1px solid #e9ecf2;border-radius:16px;padding:24px;background:#fff;box-shadow:0 4px 16px rgba(32,35,56,.06)}h1{font-size:20px;margin:0 0 8px}p{color:#64748b;margin:0 0 12px}code{color:#202338}</style>
</head><body><main><h1>Could not connect your AI app</h1><p>${htmlEscape(description)}</p>
<p>Error: <code>${htmlEscape(out.error || 'server_error')}</code></p><p>Go back to your AI app and start the connection again.</p></main></body></html>`;
}

function configuration(jwks) {
  return {
    adapter: MongoOAuthAdapter,
    jwks,
    cookies: {
      keys: cookieKeys(),
      long: { signed: true, httpOnly: true, sameSite: 'lax', secure: env.cookieSecure },
      short: { signed: true, httpOnly: true, sameSite: 'lax', secure: env.cookieSecure },
      names: { session: 'iv_oauth_session', interaction: 'iv_oauth_interaction', resume: 'iv_oauth_resume', state: 'iv_oauth_state' },
    },
    routes: OAUTH_ROUTES,
    // The MCP scopes are listed here too, so clients may name them when they
    // register (RFC 7591 `scope`) and discovery advertises them. Tokens get
    // them through the resource server (getResourceServerInfo below), and the
    // consent step records them on both levels of the grant.
    scopes: ['openid', 'offline_access', ...SCOPE_IDS],
    discovery: { service_documentation: new URL('/connect', env.CLIENT_URL).toString() },
    responseTypes: ['code'],
    clientAuthMethods: ['none', 'private_key_jwt', 'client_secret_basic', 'client_secret_post'],
    // Loopback redirects (Claude Code, other CLI and desktop clients) match on
    // any port only for native clients; native also forbids plain http to
    // anything but loopback, which is what the MCP spec requires.
    clientDefaults: {
      application_type: 'native',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      // The stored signing key is P-256 (only used if a client asks for openid).
      id_token_signed_response_alg: 'ES256',
    },
    pkce: { required: () => true },
    allowOmittingSingleRegisteredRedirectUri: false,
    expiresWithSession: () => false,
    issueRefreshToken: async (_ctx, client) => client.grantTypeAllowed('refresh_token'),
    rotateRefreshToken: () => true,
    ttl: {
      AccessToken: env.OAUTH_ACCESS_TOKEN_TTL_SECONDS,
      AuthorizationCode: 60,
      RefreshToken: env.OAUTH_REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
      Grant: env.OAUTH_REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
      Interaction: 15 * 60,
      // The consent page decides every time, so OAuth sessions are kept only
      // for the redirect back to the client.
      Session: 60,
      IdToken: 300,
    },
    features: {
      devInteractions: { enabled: false },
      userinfo: { enabled: false },
      introspection: { enabled: false },
      pushedAuthorizationRequests: { enabled: false },
      // A client may revoke only its own tokens; anything else is answered
      // like a success without revoking, so tokens cannot be probed.
      revocation: { enabled: true, allowedPolicy: async (_ctx, client, token) => token.clientId === client.clientId },
      rpInitiatedLogout: { enabled: true },
      registration: {
        enabled: env.OAUTH_DCR_ENABLED,
        initialAccessToken: false,
        issueRegistrationAccessToken: false,
      },
      clientIdMetadataDocument: {
        enabled: env.OAUTH_CIMD_ENABLED,
        ack: 'draft-02',
      },
      resourceIndicators: {
        enabled: true,
        defaultResource: async () => env.mcpResourceUrl,
        useGrantedResource: async () => true,
        getResourceServerInfo: async (_ctx, resourceIndicator) => {
          if (resourceIndicator !== env.mcpResourceUrl) {
            throw new errors.InvalidTarget(`Tokens can only be issued for ${env.mcpResourceUrl}`);
          }
          return {
            scope: SCOPE_IDS.join(' '),
            audience: env.mcpResourceUrl,
            accessTokenTTL: env.OAUTH_ACCESS_TOKEN_TTL_SECONDS,
            accessTokenFormat: 'opaque',
          };
        },
      },
    },
    fetch: (url, options) => (cimdFetchOverride ? cimdFetchOverride(url, options) : globalThis.fetch(url, options)),
    interactions: {
      policy: buildPolicy(),
      url: async (ctx, interaction) => {
        await rememberInteractionClient(ctx, interaction);
        const target = new URL(CONSENT_PATH, env.CLIENT_URL);
        target.searchParams.set('uid', interaction.uid);
        return target.toString();
      },
    },
    findAccount: async (_ctx, sub) => {
      const user = await User.findById(sub).select('_id status').lean().catch(() => null);
      if (!user || user.status !== 'active') return undefined;
      return { accountId: String(user._id), claims: async () => ({ sub: String(user._id) }) };
    },
    renderError: async (ctx, out) => {
      ctx.type = 'html';
      ctx.body = errorPage(out);
    },
  };
}

async function buildProvider() {
  const jwks = await loadSigningJwks();
  const provider = new Provider(env.oauthIssuer, configuration(jwks));
  // Endpoint URLs are built from forwarded headers, which the HTTP glue sets
  // from SERVER_URL (see http.js), so they always match the issuer.
  provider.proxy = true;
  provider.on('server_error', (_ctx, error) => logger.error({ reason: error.message }, 'OAuth server error'));
  provider.on('grant.error', (_ctx, error) => logger.warn({ error: error.error, reason: error.error_description }, 'OAuth token request refused'));
  provider.on('authorization.error', (_ctx, error) =>
    logger.warn({ error: error.error, reason: error.error_description }, 'OAuth authorization request refused'),
  );
  provider.on('registration_create.error', (_ctx, error) => logger.warn({ error: error.error }, 'OAuth client registration refused'));
  // The client revoked its own tokens (RFC 7009) or a reused refresh token
  // killed the grant: show the connection as revoked.
  provider.on('grant.revoked', (_ctx, grantId) => {
    McpConnection.updateOne({ grantId, status: 'active' }, { $set: { status: 'revoked', revokedAt: new Date(), revokedReason: 'client' } }).catch(
      (error) => logger.warn({ reason: error.message }, 'Could not mark a revoked grant'),
    );
  });
  return provider;
}

/** The authorization server, built once (it needs the stored signing key). */
export function getOAuthProvider() {
  if (!providerPromise) {
    providerPromise = buildProvider().catch((error) => {
      providerPromise = null;
      throw error;
    });
  }
  return providerPromise;
}
