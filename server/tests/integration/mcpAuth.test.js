// MCP authorization: discovery documents, OAuth 2.1 code flow with PKCE and
// resource indicators, consent (approve, narrow, deny), browser binding,
// token audience, refresh rotation and reuse detection, revocation (user,
// password change, suspension, account deletion), Client ID Metadata
// Documents with loopback redirects, and what is stored and logged.
// Protocol tests against the in-process server; no real AI app is involved.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import mongoose from 'mongoose';
import { startTestEnvironment, signupAgent, createAdminAgent, STRONG_PASSWORD } from '../fixtures/testEnvironment.js';
import {
  CLAUDE_CALLBACK,
  pkcePair,
  pathOf,
  registerClient,
  authorizeQuery,
  startAuthorization,
  authorizeAndApprove,
  resume,
  exchangeCode,
  refresh,
  connect,
  mcpPost,
  rpcBody,
  callTool,
} from '../fixtures/oauthFlow.js';

const RESOURCE = 'http://localhost:5000/mcp';
const READ_ONLY = ['infographics:read'];

let ctx;
before(async () => {
  ctx = await startTestEnvironment();
});
after(async () => {
  await ctx?.stop();
});

function challengeParams(header) {
  return Object.fromEntries([...String(header || '').matchAll(/(\w+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
}

test('discovery: protected resource and authorization server metadata meet the MCP spec', async () => {
  for (const path of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource']) {
    const prm = await request(ctx.app).get(path).set('Origin', 'https://claude.ai');
    assert.equal(prm.status, 200);
    assert.equal(prm.headers['access-control-allow-origin'], '*');
    assert.equal(prm.body.resource, RESOURCE);
    assert.deepEqual(prm.body.authorization_servers, ['http://localhost:5000']);
    assert.deepEqual(prm.body.scopes_supported, ['infographics:read', 'infographics:write']);
    assert.ok(!prm.body.scopes_supported.includes('offline_access'));
  }

  for (const path of ['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration']) {
    const as = await request(ctx.app).get(path);
    assert.equal(as.status, 200, path);
    assert.equal(as.body.issuer, 'http://localhost:5000');
    assert.equal(as.body.authorization_endpoint, 'http://localhost:5000/oauth/authorize');
    assert.equal(as.body.token_endpoint, 'http://localhost:5000/oauth/token');
    assert.equal(as.body.registration_endpoint, 'http://localhost:5000/oauth/register');
    assert.equal(as.body.revocation_endpoint, 'http://localhost:5000/oauth/revoke');
    assert.deepEqual(as.body.code_challenge_methods_supported, ['S256']);
    assert.deepEqual(as.body.response_types_supported, ['code']);
    assert.equal(as.body.authorization_response_iss_parameter_supported, true);
    assert.equal(as.body.client_id_metadata_document_supported, true);
    assert.ok(as.body.token_endpoint_auth_methods_supported.includes('none'));
    assert.ok(as.body.scopes_supported.includes('offline_access'));
    assert.ok(!as.body.grant_types_supported.includes('client_credentials'));
    assert.equal(as.body.userinfo_endpoint, undefined);
  }
});

test('the MCP endpoint refuses requests without a valid token, with a spec challenge', async () => {
  const missing = await mcpPost(ctx.app, null, { method: 'tools/list' });
  assert.equal(missing.status, 401);
  const params = challengeParams(missing.headers['www-authenticate']);
  assert.equal(params.resource_metadata, 'http://localhost:5000/.well-known/oauth-protected-resource/mcp');

  const bogus = await mcpPost(ctx.app, 'not-a-real-token-value-0123456789', { method: 'tools/list' });
  assert.equal(bogus.status, 401);
  assert.equal(challengeParams(bogus.headers['www-authenticate']).error, 'invalid_token');

  // A token in the query string is never accepted.
  const { agent } = await signupAgent(ctx.app);
  const { tokens } = await connect(ctx.app, agent);
  const viaQuery = await request(ctx.app)
    .post(`/mcp?access_token=${tokens.access_token}`)
    .set('Accept', 'application/json, text/event-stream')
    .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(viaQuery.status, 401);

  // MCP tokens are not session cookies: the dashboard API ignores them.
  const api = await request(ctx.app).get('/api/infographics').set('Authorization', `Bearer ${tokens.access_token}`);
  assert.equal(api.status, 401);
});

test('full flow: dynamic registration, PKCE, consent, code, tokens, tools', async () => {
  const { agent, user } = await signupAgent(ctx.app);
  const client = await registerClient(ctx.app, { client_name: 'Claude' });
  assert.equal(client.token_endpoint_auth_method, 'none');
  assert.equal(client.registration_access_token, undefined);

  const flow = await authorizeAndApprove(agent, { clientId: client.client_id, resource: RESOURCE, scope: 'infographics:read infographics:write offline_access' });
  assert.equal(flow.consent.client.name, 'Claude');
  assert.equal(flow.consent.client.redirectHost, 'claude.ai');
  assert.equal(flow.consent.client.registration, 'dynamic');
  assert.equal(flow.consent.account.email, user.email);
  assert.equal(flow.callback.searchParams.get('iss'), 'http://localhost:5000');
  assert.equal(flow.callback.searchParams.get('state'), 'st4te');
  assert.ok(flow.code);

  // Wrong verifier, then the right one; a code works once.
  const wrong = await exchangeCode(ctx.app, { clientId: client.client_id, code: flow.code, verifier: pkcePair().verifier, resource: RESOURCE });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error, 'invalid_grant');
  const flow2 = await authorizeAndApprove(agent, { clientId: client.client_id, resource: RESOURCE });
  const token = await exchangeCode(ctx.app, { clientId: client.client_id, code: flow2.code, verifier: flow2.verifier, resource: RESOURCE });
  assert.equal(token.status, 200, JSON.stringify(token.body));
  assert.equal(token.body.token_type, 'Bearer');
  assert.equal(token.body.expires_in, 3600);
  assert.ok(token.body.refresh_token);
  assert.equal(token.body.scope, 'infographics:read infographics:write');
  assert.equal((await callTool(ctx.app, token.body.access_token, 'list_infographics')).res.status, 200);
  // Replaying a used code is treated as theft: the tokens it produced are revoked.
  const again = await exchangeCode(ctx.app, { clientId: client.client_id, code: flow2.code, verifier: flow2.verifier, resource: RESOURCE });
  assert.equal(again.status, 400);
  assert.equal((await callTool(ctx.app, token.body.access_token, 'list_infographics')).res.status, 401);
  assert.equal((await ctx.models.McpConnection.findById(flow2.connection.id).lean()).status, 'revoked');

  const flow3 = await authorizeAndApprove(agent, { clientId: client.client_id, resource: RESOURCE });
  const fresh = await exchangeCode(ctx.app, { clientId: client.client_id, code: flow3.code, verifier: flow3.verifier, resource: RESOURCE });
  assert.equal(fresh.status, 200);
  token.body = fresh.body;

  const init = await mcpPost(ctx.app, token.body.access_token, {
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
  });
  assert.equal(init.status, 200);
  assert.equal(rpcBody(init).result.serverInfo.name, 'ai-infographic-studio');
  const tools = rpcBody(await mcpPost(ctx.app, token.body.access_token, { method: 'tools/list' })).result.tools;
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    ['generate_infographic', 'get_generation_status', 'get_infographic', 'list_infographics'],
  );
  const generate = tools.find((tool) => tool.name === 'generate_infographic');
  assert.match(generate.description, /Kie\.ai credits/);
  assert.deepEqual(generate.inputSchema.required.includes('confirm_paid_generation'), true);
  assert.equal(generate.annotations.readOnlyHint, false);
  assert.equal(tools.find((tool) => tool.name === 'list_infographics').annotations.readOnlyHint, true);

  const listed = await callTool(ctx.app, token.body.access_token, 'list_infographics');
  assert.equal(listed.res.status, 200);
  assert.equal(listed.body.result.isError, undefined);
  assert.deepEqual(listed.body.result.structuredContent, { count: 0, total: 0, page: 1, pages: 1, infographics: [] });

  const connections = await agent.get('/api/mcp/connections');
  assert.equal(connections.body.items.length, 3);
  assert.deepEqual(connections.body.items.map((item) => item.status).sort(), ['active', 'active', 'revoked']);
  assert.ok(connections.body.items.every((item) => item.clientName === 'Claude'));
});

test('PKCE is required and only S256 is accepted; redirect URIs must match exactly', async () => {
  const { agent } = await signupAgent(ctx.app);
  const client = await registerClient(ctx.app);

  const noPkce = await agent.get(authorizeQuery({ clientId: client.client_id }));
  assert.equal(noPkce.status, 303);
  const noPkceTarget = new URL(noPkce.headers.location);
  assert.equal(noPkceTarget.origin + noPkceTarget.pathname, CLAUDE_CALLBACK);
  assert.equal(noPkceTarget.searchParams.get('error'), 'invalid_request');

  const plain = await agent.get(authorizeQuery({ clientId: client.client_id, challenge: 'a'.repeat(43), method: 'plain' }));
  assert.equal(new URL(plain.headers.location).searchParams.get('error'), 'invalid_request');

  // An unregistered redirect URI is never redirected to.
  const evil = await agent.get(authorizeQuery({ clientId: client.client_id, challenge: pkcePair().challenge, redirectUri: 'https://evil.example/cb' }));
  assert.equal(evil.status, 400);
  assert.equal(evil.headers.location, undefined);
  assert.match(evil.text, /Could not connect your AI app/);

  // Plain http is only allowed for loopback addresses.
  const httpRegistration = await request(ctx.app)
    .post('/oauth/register')
    .send({ client_name: 'Bad', redirect_uris: ['http://evil.example/callback'], token_endpoint_auth_method: 'none' });
  assert.equal(httpRegistration.status, 400);
  assert.equal(httpRegistration.body.error, 'invalid_redirect_uri');

  // Tokens can only be requested for this MCP server.
  const otherResource = await agent.get(authorizeQuery({ clientId: client.client_id, challenge: pkcePair().challenge, resource: 'https://other.example/mcp' }));
  assert.equal(new URL(otherResource.headers.location).searchParams.get('error'), 'invalid_target');
});

test('consent needs the signed-in user, can be denied, and is bound to the browser that started it', async () => {
  const alice = await signupAgent(ctx.app);
  const mallory = await signupAgent(ctx.app);
  const client = await registerClient(ctx.app, { client_name: 'Shady App' });
  const { challenge } = pkcePair();

  const started = await startAuthorization(alice.agent, { clientId: client.client_id, challenge });
  const anonymous = await request(ctx.app).get(`/api/oauth/interactions/${started.uid}`);
  assert.equal(anonymous.status, 401);

  // Mallory approves Alice's request with her own account: the redirect back
  // only works in the browser that started it, so nothing is issued.
  const hijack = await mallory.agent.post(`/api/oauth/interactions/${started.uid}/approve`).send({ scopes: ['infographics:read'] });
  assert.equal(hijack.status, 200);
  const hijackResume = await mallory.agent.get(pathOf(hijack.body.redirectTo));
  assert.notEqual(hijackResume.status, 303);
  assert.match(hijackResume.text, /Could not connect your AI app/);

  // A fresh request denied by Alice ends with access_denied at the client.
  const second = await startAuthorization(alice.agent, { clientId: client.client_id, challenge });
  const denied = await alice.agent.post(`/api/oauth/interactions/${second.uid}/deny`).send({});
  assert.equal(denied.status, 200);
  const callback = await resume(alice.agent, denied.body.redirectTo);
  assert.equal(callback.searchParams.get('error'), 'access_denied');
  assert.equal(callback.searchParams.get('code'), null);

  // An answered request cannot be answered again.
  const replay = await alice.agent.post(`/api/oauth/interactions/${second.uid}/approve`).send({ scopes: ['infographics:read'] });
  assert.ok([409, 410].includes(replay.status));

  const activity = await alice.agent.get('/api/mcp/activity');
  assert.ok(activity.body.items.some((item) => item.action === 'mcp.connection.denied'));
});

test('narrowed consent: read-only tokens get a 403 insufficient_scope challenge for paid tools', async () => {
  const { agent } = await signupAgent(ctx.app);
  const { tokens } = await connect(ctx.app, agent, { scopes: READ_ONLY });
  assert.equal(tokens.scope, 'infographics:read');

  const read = await callTool(ctx.app, tokens.access_token, 'list_infographics');
  assert.equal(read.res.status, 200);

  const paid = await callTool(ctx.app, tokens.access_token, 'generate_infographic', {
    topic: 'How a small bakery can use AI to plan its weekly baking.',
    style: 'minimal',
    aspect_ratio: '1:1',
    confirm_paid_generation: true,
  });
  assert.equal(paid.res.status, 403);
  const params = challengeParams(paid.res.headers['www-authenticate']);
  assert.equal(params.error, 'insufficient_scope');
  assert.equal(params.scope, 'infographics:write');
  assert.equal(params.resource_metadata, 'http://localhost:5000/.well-known/oauth-protected-resource/mcp');

  const consent = await agent.get('/api/mcp/connections');
  assert.deepEqual(consent.body.items[0].scopes.map((scope) => scope.id), READ_ONLY);
});

test('refresh tokens rotate; reusing an old one revokes the whole connection', async () => {
  const { agent } = await signupAgent(ctx.app);
  const { client, tokens, connection } = await connect(ctx.app, agent);

  const first = await refresh(ctx.app, { clientId: client.client_id, refreshToken: tokens.refresh_token });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.notEqual(first.body.refresh_token, tokens.refresh_token);
  assert.equal((await callTool(ctx.app, first.body.access_token, 'list_infographics')).res.status, 200);

  const reuse = await refresh(ctx.app, { clientId: client.client_id, refreshToken: tokens.refresh_token });
  assert.equal(reuse.status, 400);
  assert.equal(reuse.body.error, 'invalid_grant');
  assert.equal((await callTool(ctx.app, first.body.access_token, 'list_infographics')).res.status, 401);
  const later = await refresh(ctx.app, { clientId: client.client_id, refreshToken: first.body.refresh_token });
  assert.equal(later.status, 400);
  assert.equal(later.body.error, 'invalid_grant');

  const stored = await ctx.models.McpConnection.findById(connection.id).lean();
  assert.equal(stored.status, 'revoked');
});

test('revoking a connection stops its tokens at once', async () => {
  const { agent } = await signupAgent(ctx.app);
  const { client, tokens, connection } = await connect(ctx.app, agent);
  const other = await connect(ctx.app, agent);
  assert.equal((await callTool(ctx.app, tokens.access_token, 'list_infographics')).res.status, 200);

  const someoneElse = await signupAgent(ctx.app);
  const foreign = await someoneElse.agent.delete(`/api/mcp/connections/${connection.id}`);
  assert.equal(foreign.status, 404);

  const revoked = await agent.delete(`/api/mcp/connections/${connection.id}`);
  assert.equal(revoked.status, 200);
  assert.equal(revoked.body.connection.status, 'revoked');
  assert.equal((await callTool(ctx.app, tokens.access_token, 'list_infographics')).res.status, 401);
  const refreshed = await refresh(ctx.app, { clientId: client.client_id, refreshToken: tokens.refresh_token });
  assert.equal(refreshed.status, 400);
  // The other connection is untouched.
  assert.equal((await callTool(ctx.app, other.tokens.access_token, 'list_infographics')).res.status, 200);

  const activity = await agent.get('/api/mcp/activity');
  assert.ok(activity.body.items.some((item) => item.action === 'mcp.connection.revoked'));
});

test('the client can revoke its own refresh token (RFC 7009)', async () => {
  const { agent } = await signupAgent(ctx.app);
  const { client, tokens, connection } = await connect(ctx.app, agent);
  const res = await request(ctx.app)
    .post('/oauth/revoke')
    .type('form')
    .send(new URLSearchParams({ token: tokens.refresh_token, token_type_hint: 'refresh_token', client_id: client.client_id }).toString());
  assert.equal(res.status, 200);
  const refreshed = await refresh(ctx.app, { clientId: client.client_id, refreshToken: tokens.refresh_token });
  assert.equal(refreshed.status, 400);
  const stored = await ctx.models.McpConnection.findById(connection.id).lean();
  assert.equal(stored.status, 'revoked');
});

test('password change, suspension and account deletion cut AI access', async () => {
  const owner = await signupAgent(ctx.app);
  const { tokens } = await connect(ctx.app, owner.agent);
  const changed = await owner.agent
    .post('/api/settings/account/password')
    .send({ currentPassword: STRONG_PASSWORD, newPassword: 'Another2026Password' });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal((await callTool(ctx.app, tokens.access_token, 'list_infographics')).res.status, 401);

  const suspendedUser = await signupAgent(ctx.app);
  const suspendedTokens = (await connect(ctx.app, suspendedUser.agent)).tokens;
  const admin = await createAdminAgent(ctx.app, ctx.models);
  const suspend = await admin.agent.patch(`/api/admin/users/${suspendedUser.user.id}`).send({ status: 'suspended', reason: 'test' });
  assert.equal(suspend.status, 200, JSON.stringify(suspend.body));
  assert.equal((await callTool(ctx.app, suspendedTokens.access_token, 'list_infographics')).res.status, 401);

  const leaving = await signupAgent(ctx.app);
  const leavingTokens = (await connect(ctx.app, leaving.agent)).tokens;
  const deleted = await leaving.agent.post('/api/settings/account/delete').send({ password: STRONG_PASSWORD });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  assert.equal((await callTool(ctx.app, leavingTokens.access_token, 'list_infographics')).res.status, 401);
  assert.equal(await ctx.models.McpConnection.countDocuments({ userId: leaving.user.id }), 0);
});

test('Client ID Metadata Documents: URL client ids, loopback redirects on any port, warning shown', async (t) => {
  const { __setCimdFetch } = await import('../../src/mcp/oauthServer.js');
  const CLIENT_ID = 'https://cli.example.test/oauth/client-metadata.json';
  const fetched = [];
  __setCimdFetch(async (url) => {
    fetched.push(String(url));
    if (String(url) !== CLIENT_ID) return new Response('not found', { status: 404 });
    return new Response(
      JSON.stringify({
        client_id: CLIENT_ID,
        client_name: 'Example CLI',
        client_uri: 'https://cli.example.test',
        redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
      { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'max-age=60' } },
    );
  });
  t.after(() => __setCimdFetch(null));

  const { agent } = await signupAgent(ctx.app);
  const redirectUri = 'http://127.0.0.1:43117/callback';
  const flow = await authorizeAndApprove(agent, { clientId: CLIENT_ID, redirectUri, resource: RESOURCE });
  assert.ok(fetched.includes(CLIENT_ID));
  assert.equal(flow.consent.client.name, 'Example CLI');
  assert.equal(flow.consent.client.publishedBy, 'cli.example.test');
  assert.equal(flow.consent.client.registration, 'metadata_document');
  assert.equal(flow.consent.client.loopbackOnly, true);
  assert.equal(flow.callback.origin, 'http://127.0.0.1:43117');

  const token = await exchangeCode(ctx.app, { clientId: CLIENT_ID, code: flow.code, verifier: flow.verifier, redirectUri, resource: RESOURCE });
  assert.equal(token.status, 200, JSON.stringify(token.body));
  assert.equal((await callTool(ctx.app, token.body.access_token, 'list_infographics')).res.status, 200);

  // Same document, a different localhost port: still accepted.
  const other = await authorizeAndApprove(agent, { clientId: CLIENT_ID, redirectUri: 'http://localhost:51234/callback' });
  assert.equal(other.callback.origin, 'http://localhost:51234');

  // A redirect the document does not list is refused.
  const bad = await agent.get(authorizeQuery({ clientId: CLIENT_ID, redirectUri: 'https://evil.example/callback', challenge: pkcePair().challenge }));
  assert.equal(bad.status, 400);
});

test('ChatGPT-style client: metadata document with private_key_jwt client authentication', async (t) => {
  const { generateKeyPair, exportJWK, SignJWT } = await import('jose');
  const { __setCimdFetch } = await import('../../src/mcp/oauthServer.js');
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key-1', alg: 'RS256', use: 'sig' };
  const CLIENT_ID = 'https://chat.example.test/oauth/client.json';
  const JWKS_URI = 'https://chat.example.test/oauth/jwks.json';
  const REDIRECT = 'https://chat.example.test/connector_platform_oauth_redirect';
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  __setCimdFetch(async (url) => {
    if (String(url) === CLIENT_ID) {
      return json({
        client_id: CLIENT_ID,
        client_name: 'Chat Example',
        client_uri: 'https://chat.example.test/',
        redirect_uris: [REDIRECT],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'private_key_jwt',
        token_endpoint_auth_signing_alg: 'RS256',
        jwks_uri: JWKS_URI,
      });
    }
    if (String(url) === JWKS_URI) return json({ keys: [jwk] });
    return new Response('not found', { status: 404 });
  });
  t.after(() => __setCimdFetch(null));

  const { agent } = await signupAgent(ctx.app);
  const flow = await authorizeAndApprove(agent, { clientId: CLIENT_ID, redirectUri: REDIRECT, resource: RESOURCE });
  assert.equal(flow.consent.client.publishedBy, 'chat.example.test');
  assert.equal(flow.consent.client.loopbackOnly, false);
  assert.equal(flow.callback.searchParams.get('iss'), 'http://localhost:5000');

  const tokenRequest = (assertion) => {
    const form = new URLSearchParams({ grant_type: 'authorization_code', client_id: CLIENT_ID, code: flow.code, redirect_uri: REDIRECT, code_verifier: flow.verifier, resource: RESOURCE });
    if (assertion) {
      form.set('client_assertion_type', 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
      form.set('client_assertion', assertion);
    }
    return request(ctx.app).post('/oauth/token').type('form').send(form.toString());
  };
  // Without the signed client assertion the confidential client is refused.
  const unsigned = await tokenRequest(null);
  assert.equal(unsigned.status, 401);
  assert.equal(unsigned.body.error, 'invalid_client');

  const assertion = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
    .setIssuer(CLIENT_ID)
    .setSubject(CLIENT_ID)
    .setAudience('http://localhost:5000')
    .setJti(`jti-${Date.now()}`)
    .setIssuedAt()
    .setExpirationTime('60s')
    .sign(privateKey);
  const signed = await tokenRequest(assertion);
  assert.equal(signed.status, 200, JSON.stringify(signed.body));
  assert.equal((await callTool(ctx.app, signed.body.access_token, 'list_infographics')).res.status, 200);
});

test('stored tokens are hashed and audit entries are sanitized', async () => {
  const { agent, user } = await signupAgent(ctx.app);
  const { tokens } = await connect(ctx.app, agent);
  const db = mongoose.connection.db;
  const dump = JSON.stringify([
    ...(await db.collection('oauth_accesstoken').find({}).toArray()),
    ...(await db.collection('oauth_refreshtoken').find({}).toArray()),
  ]);
  assert.ok(!dump.includes(tokens.access_token));
  assert.ok(!dump.includes(tokens.refresh_token));

  const prompt = 'This private topic text must never be written to the audit log at all.';
  await callTool(ctx.app, tokens.access_token, 'generate_infographic', {
    topic: prompt,
    style: 'colorful',
    aspect_ratio: '9:16',
    confirm_paid_generation: true,
  });
  const entries = await ctx.models.AuditLog.find({ actorId: user.id, area: 'mcp' }).lean();
  const logged = JSON.stringify(entries);
  assert.ok(entries.some((entry) => entry.action === 'mcp.tool.generate_infographic' && entry.outcome === 'failure'));
  assert.ok(!logged.includes('private topic'));
  assert.ok(!logged.includes(tokens.access_token));
  const call = entries.find((entry) => entry.action === 'mcp.tool.generate_infographic');
  assert.equal(call.metadata.args.topic, `[text, ${prompt.length} chars]`);
  assert.equal(call.metadata.client, 'Test AI App');
});

test('connect page data: server URL, reachability, scopes and tools', async () => {
  const { agent } = await signupAgent(ctx.app);
  const info = await agent.get('/api/mcp/info');
  assert.equal(info.status, 200);
  assert.equal(info.body.url, RESOURCE);
  assert.equal(info.body.reachability.publicHttps, false);
  assert.equal(info.body.reachability.cloudClients, false);
  assert.equal(info.body.tools.length, 4);
  assert.deepEqual(info.body.clientVerification, { claude: 'not_tested', chatgpt: 'not_tested', claudeCode: 'not_tested' });
  assert.equal((await request(ctx.app).get('/api/mcp/info')).status, 401);
});
