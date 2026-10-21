// AI client connections (MCP over OAuth): the consent decision, the list the
// user manages on the MCP Connection page, revocation and activity.
//
// The consent page is a normal signed-in page of the web app. The OAuth
// request it answers is bound to the browser that started it (oidc-provider's
// resume cookie), so a consent link opened elsewhere cannot complete it.
import { env } from '../config/env.js';
import { McpConnection } from '../models/McpConnection.js';
import { AuditLog } from '../models/AuditLog.js';
import { getOAuthProvider, interactionClient, isMetadataDocumentClientId } from '../mcp/oauthServer.js';
import { revokeGrantArtifacts, pinClient } from '../mcp/oauthStore.js';
import { SCOPES, SCOPE_IDS, normalizeScopes, describeScopes } from '../mcp/scopes.js';
import { TOOL_SUMMARIES } from '../mcp/toolCatalog.js';
import epochTime from '../mcp/epochTime.js';
import { recordAudit } from './audit.service.js';
import { mcpAllowed } from './platformSettings.service.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import { isObjectId } from '../utils/sanitize.js';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const UID_SHAPE = /^[A-Za-z0-9_-]{10,64}$/;
// Grants live at most this long; refresh tokens expire sooner when unused.
export const MAX_CONNECTION_DAYS = 365;

// Live tests with real AI apps (update after a recorded test, with evidence in docs/test-results.md).
const CLIENT_VERIFICATION = Object.freeze({
  claude: 'not_tested',
  chatgpt: 'not_tested',
  claudeCode: 'not_tested',
});

function urlHost(value) {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

function urlHostname(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function isPrivateHost(hostname) {
  return (
    !hostname ||
    LOOPBACK_HOSTS.has(hostname) ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.localhost') ||
    /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname)
  );
}

// ---------------------------------------------------------------- info

export async function mcpInfo() {
  const hostname = urlHostname(env.mcpResourceUrl);
  const https = env.mcpResourceUrl.startsWith('https://');
  const publicHttps = https && !isPrivateHost(hostname);
  return {
    enabled: env.MCP_ENABLED,
    // False while an administrator has turned AI-app access off.
    available: env.MCP_ENABLED && (await mcpAllowed()),
    url: env.mcpResourceUrl,
    issuer: env.oauthIssuer,
    transport: 'Streamable HTTP',
    protocol: { current: '2026-07-28', legacy: '2025-era clients are served statelessly' },
    authentication: 'OAuth 2.1 (authorization code + PKCE S256, resource indicators)',
    registration: { metadataDocument: env.OAUTH_CIMD_ENABLED, dynamic: env.OAUTH_DCR_ENABLED },
    reachability: {
      https,
      publicHttps,
      // Cloud clients (Claude on the web/desktop/mobile, ChatGPT) connect from
      // their own servers, so they need a public HTTPS address.
      cloudClients: publicHttps,
      localClients: true,
    },
    tokens: {
      accessTokenMinutes: Math.round(env.OAUTH_ACCESS_TOKEN_TTL_SECONDS / 60),
      refreshTokenIdleDays: env.OAUTH_REFRESH_TOKEN_TTL_DAYS,
      maxConnectionDays: MAX_CONNECTION_DAYS,
    },
    scopes: SCOPES,
    tools: TOOL_SUMMARIES,
    clientVerification: CLIENT_VERIFICATION,
  };
}

// ---------------------------------------------------------------- consent

async function pendingInteraction(uid) {
  if (!UID_SHAPE.test(String(uid || ''))) throw new NotFoundError('This connection request was not found. Start again from your AI app.');
  const provider = await getOAuthProvider();
  const interaction = await provider.Interaction.find(uid);
  const client = interaction ? await interactionClient(uid) : null;
  if (!interaction || !client) {
    throw new AppError('This connection request has expired. Start the connection again from your AI app.', {
      statusCode: 410,
      code: 'INTERACTION_EXPIRED',
    });
  }
  if (interaction.result) {
    throw new AppError('This connection request was already answered. Start again from your AI app if it did not connect.', {
      statusCode: 409,
      code: 'INTERACTION_DONE',
    });
  }
  return { provider, interaction, client };
}

/** Scopes the client asked for (all of them when it asked for none of ours). */
function offeredScopes(params) {
  const requested = normalizeScopes(params.scope);
  return requested.length ? requested : [...SCOPE_IDS];
}

function describeClient(client, params) {
  const redirectUri = params.redirect_uri || null;
  const redirectHostnames = (client.redirectUris || []).map(urlHostname);
  return {
    name: client.clientName || 'Unnamed AI app',
    clientId: client.clientId,
    clientUri: client.clientUri || null,
    // For metadata-document clients the id is a URL on the client's own domain.
    publishedBy: client.registration === 'metadata_document' ? urlHost(client.clientId) : null,
    registration: client.registration,
    redirectUri,
    redirectHost: urlHost(redirectUri),
    loopbackOnly: redirectHostnames.length > 0 && redirectHostnames.every((host) => LOOPBACK_HOSTS.has(host)),
  };
}

export async function getConsentRequest(user, uid) {
  const { interaction, client } = await pendingInteraction(uid);
  return {
    uid,
    client: describeClient(client, interaction.params),
    resource: env.mcpResourceUrl,
    scopes: describeScopes(offeredScopes(interaction.params)),
    account: { name: user.name, email: user.email },
    expiresAt: new Date(interaction.exp * 1000),
  };
}

export async function approveConsent(user, uid, { scopes }, req) {
  if (!(await mcpAllowed())) {
    throw new AppError('AI app connections are turned off by the administrator right now.', { statusCode: 503, code: 'MCP_DISABLED' });
  }
  const { provider, interaction, client } = await pendingInteraction(uid);
  const params = interaction.params;
  const offered = offeredScopes(params);
  const approved = normalizeScopes(scopes).filter((id) => offered.includes(id));
  if (approved.length === 0) {
    throw new AppError('Allow at least one permission, or choose Deny.', { statusCode: 400, code: 'NO_SCOPES' });
  }
  const rejected = offered.filter((id) => !approved.includes(id));
  const accountId = String(user._id);

  const grant = new provider.Grant({ accountId, clientId: params.client_id });
  grant.addResourceScope(env.mcpResourceUrl, approved.join(' '));
  // Recorded as declined, so the request completes with fewer scopes instead
  // of asking again.
  if (rejected.length) grant.rejectResourceScope(env.mcpResourceUrl, rejected.join(' '));
  // The same decision at the authorization-server level (the MCP scopes are
  // also registered there), plus the OpenID scopes some clients add: openid
  // (an ID token with only the account id) and offline_access (a refresh
  // token, issued anyway to clients that registered the refresh_token grant).
  const oidcExtras = String(params.scope || '').split(' ').filter((scope) => scope === 'openid' || scope === 'offline_access');
  grant.addOIDCScope([...approved, ...oidcExtras].join(' '));
  if (rejected.length) grant.rejectOIDCScope(rejected.join(' '));
  const grantId = await grant.save();

  interaction.result = { login: { accountId, remember: false }, consent: { grantId } };
  await interaction.save(Math.max(1, interaction.exp - epochTime()));

  const described = describeClient(client, params);
  const connection = await McpConnection.create({
    userId: user._id,
    clientId: client.clientId,
    clientName: described.name,
    clientUri: described.clientUri,
    registration: client.registration,
    redirectHosts: described.redirectHost ? [described.redirectHost] : [],
    grantId,
    scopes: approved,
  });
  if (client.registration === 'dynamic') await pinClient(client.clientId);

  await recordAudit({
    req,
    actor: user,
    action: 'mcp.connection.approved',
    area: 'mcp',
    target: { type: 'mcp_connection', id: connection._id },
    summary: `Approved "${described.name}" (${approved.join(', ')})`.slice(0, 500),
    metadata: { client: described.name, publishedBy: described.publishedBy, redirectHost: described.redirectHost, scopes: approved, declined: rejected },
  });
  return { redirectTo: interaction.returnTo, connection: toConnectionDto(connection) };
}

export async function denyConsent(user, uid, req) {
  const { interaction, client } = await pendingInteraction(uid);
  interaction.result = { error: 'access_denied', error_description: 'The AI Infographic Studio account owner denied this connection.' };
  await interaction.save(Math.max(1, interaction.exp - epochTime()));
  const described = describeClient(client, interaction.params);
  await recordAudit({
    req,
    actor: user,
    action: 'mcp.connection.denied',
    area: 'mcp',
    summary: `Denied "${described.name}"`.slice(0, 500),
    metadata: { client: described.name, publishedBy: described.publishedBy, redirectHost: described.redirectHost },
  });
  return { redirectTo: interaction.returnTo };
}

// ---------------------------------------------------------------- connections

export function toConnectionDto(connection) {
  return {
    id: String(connection._id),
    clientName: connection.clientName || 'AI app',
    clientId: connection.clientId,
    publishedBy: connection.registration === 'metadata_document' ? urlHost(connection.clientId) : null,
    registration: connection.registration,
    redirectHosts: connection.redirectHosts || [],
    scopes: describeScopes(connection.scopes || []),
    status: connection.status,
    createdAt: connection.createdAt,
    lastUsedAt: connection.lastUsedAt || null,
    lastTool: connection.lastTool || null,
    revokedAt: connection.revokedAt || null,
    revokedReason: connection.revokedReason || null,
  };
}

export async function listConnections(user) {
  const items = await McpConnection.find({ userId: user._id }).sort({ status: 1, createdAt: -1 }).limit(100).lean();
  return { items: items.map(toConnectionDto) };
}

async function revokeOne(connection, reason) {
  await revokeGrantArtifacts(connection.grantId);
  await McpConnection.updateOne(
    { _id: connection._id, status: 'active' },
    { $set: { status: 'revoked', revokedAt: new Date(), revokedReason: reason } },
  );
}

export async function revokeConnection(user, id, req) {
  if (!isObjectId(String(id))) throw new NotFoundError('Connection not found');
  const connection = await McpConnection.findOne({ _id: id, userId: user._id }).lean();
  if (!connection) throw new NotFoundError('Connection not found');
  if (connection.status === 'active') {
    await revokeOne(connection, 'user');
    await recordAudit({
      req,
      actor: user,
      action: 'mcp.connection.revoked',
      area: 'mcp',
      target: { type: 'mcp_connection', id: connection._id },
      summary: `Revoked "${connection.clientName || 'AI app'}"`.slice(0, 500),
      metadata: { client: connection.clientName },
    });
  }
  return toConnectionDto(await McpConnection.findById(connection._id).lean());
}

/** Revoke every active connection of a user (password change or reset, account deletion). */
export async function revokeAllConnections(userId, reason) {
  const active = await McpConnection.find({ userId, status: 'active' }).lean();
  for (const connection of active) await revokeOne(connection, reason);
  return active.length;
}

/** Account deletion: revoke and forget every connection. */
export async function deleteAllConnectionsOf(userId) {
  await revokeAllConnections(userId, 'account_deleted');
  await McpConnection.deleteMany({ userId });
}

/** The grant was revoked by the client itself (token revocation endpoint). */
export async function markGrantRevoked(grantId) {
  await McpConnection.updateOne(
    { grantId, status: 'active' },
    { $set: { status: 'revoked', revokedAt: new Date(), revokedReason: 'client' } },
  );
}

export async function listActivity(user, { limit = 30 } = {}) {
  const entries = await AuditLog.find({ actorId: user._id, area: 'mcp' }).sort({ createdAt: -1 }).limit(limit).lean();
  return {
    items: entries.map((entry) => ({
      id: String(entry._id),
      action: entry.action,
      outcome: entry.outcome,
      summary: entry.summary,
      client: entry.metadata?.client || null,
      tool: entry.metadata?.tool || null,
      createdAt: entry.createdAt,
    })),
  };
}
