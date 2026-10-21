// End to end with the official MCP TypeScript SDK client (v2) over real HTTP:
// the SDK discovers the protected resource and authorization server, registers
// (Dynamic Client Registration, or a Client ID Metadata Document), runs PKCE,
// validates the `iss` response parameter, exchanges the code and calls tools,
// on both the 2025-era handshake and the 2026-07-28 protocol.
//
// This is a protocol test. It is NOT a test of Claude, ChatGPT or any other
// AI app; those have to be connected for real (see docs/test-results.md).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import request from 'supertest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startTestEnvironment, uniqueEmail, STRONG_PASSWORD } from '../fixtures/testEnvironment.js';
import { pathOf } from '../fixtures/oauthFlow.js';

let ctx;
let server;
let BASE;

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

before(async () => {
  const port = await freePort();
  BASE = `http://127.0.0.1:${port}`;
  ctx = await startTestEnvironment({ SERVER_URL: BASE });
  server = http.createServer(ctx.app);
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
});
after(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await ctx?.stop();
});

/** A minimal OAuth client provider, the way an MCP host app implements it. */
class TestAuthProvider {
  constructor({ redirectUrl, clientMetadataUrl } = {}) {
    this._redirectUrl = redirectUrl || 'http://127.0.0.1:47321/callback';
    if (clientMetadataUrl) this.clientMetadataUrl = clientMetadataUrl;
    this.authorizationUrl = null;
  }

  get redirectUrl() {
    return this._redirectUrl;
  }

  get clientMetadata() {
    return {
      client_name: 'SDK Test Client',
      redirect_uris: [this._redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  clientInformation() {
    return this._client;
  }

  saveClientInformation(info) {
    this._client = info;
  }

  tokens() {
    return this._tokens;
  }

  saveTokens(tokens) {
    this._tokens = tokens;
  }

  redirectToAuthorization(url) {
    this.authorizationUrl = new URL(url);
  }

  saveCodeVerifier(verifier) {
    this._verifier = verifier;
  }

  codeVerifier() {
    return this._verifier;
  }

  // Lets the SDK check that the callback comes from the authorization server it started with.
  saveDiscoveryState(state) {
    this._discovery = state;
  }

  discoveryState() {
    return this._discovery;
  }
}

async function signedInBrowser() {
  const browser = request.agent(BASE);
  const res = await browser.post('/api/auth/signup').send({ name: 'SDK User', email: uniqueEmail('sdk'), password: STRONG_PASSWORD });
  assert.equal(res.status, 201);
  return browser;
}

/** The user's part: open the authorization URL, approve, follow the redirect back. */
async function approveInBrowser(browser, authorizationUrl, scopes) {
  const start = await browser.get(pathOf(authorizationUrl.toString()));
  assert.equal(start.status, 303, start.text);
  const uid = new URL(start.headers.location).searchParams.get('uid');
  const consent = await browser.get(`/api/oauth/interactions/${uid}`);
  assert.equal(consent.status, 200);
  const approved = await browser.post(`/api/oauth/interactions/${uid}/approve`).send({ scopes: scopes || consent.body.scopes.map((scope) => scope.id) });
  assert.equal(approved.status, 200);
  const back = await browser.get(pathOf(approved.body.redirectTo));
  assert.equal(back.status, 303);
  return { callback: new URL(back.headers.location), consent: consent.body };
}

async function connectWithSdk(provider, browser, clientOptions) {
  const url = new URL(`${BASE}/mcp`);
  const first = new StreamableHTTPClientTransport(url, { authProvider: provider });
  const probe = new Client({ name: 'studio-sdk-test', version: '1.0.0' }, clientOptions);
  const failure = await probe.connect(first).then(() => null, (error) => error);
  assert.ok(failure, 'unauthenticated connect must fail');
  assert.ok(provider.authorizationUrl, 'the SDK asked the user to authorize');
  assert.equal(provider.authorizationUrl.origin + provider.authorizationUrl.pathname, `${BASE}/oauth/authorize`);
  assert.equal(provider.authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(provider.authorizationUrl.searchParams.get('resource'), `${BASE}/mcp`);

  const { callback, consent } = await approveInBrowser(browser, provider.authorizationUrl);
  await first.finishAuth(callback.searchParams);
  assert.ok(provider.tokens()?.access_token);

  const transport = new StreamableHTTPClientTransport(url, { authProvider: provider });
  const client = new Client({ name: 'studio-sdk-test', version: '1.0.0' }, clientOptions);
  await client.connect(transport);
  return { client, transport, consent };
}

test('SDK client, 2025-era handshake: discovery, dynamic registration, PKCE, tools', async () => {
  const browser = await signedInBrowser();
  const provider = new TestAuthProvider();
  const { client, consent } = await connectWithSdk(provider, browser);
  assert.equal(consent.client.name, 'SDK Test Client');
  assert.equal(consent.client.registration, 'dynamic');
  assert.ok(provider.clientInformation()?.client_id);

  const { tools } = await client.listTools();
  assert.equal(tools.length, 4);
  const result = await client.callTool({ name: 'list_infographics', arguments: {} });
  assert.deepEqual(result.structuredContent, { count: 0, total: 0, page: 1, pages: 1, infographics: [] });
  await client.close();
});

test('SDK client, 2026-07-28 protocol: negotiated and served', async () => {
  const browser = await signedInBrowser();
  const provider = new TestAuthProvider();
  const options = { versionNegotiation: { mode: { pin: '2026-07-28' } } };
  const { client } = await connectWithSdk(provider, browser, options);
  const { tools } = await client.listTools();
  assert.ok(tools.some((tool) => tool.name === 'generate_infographic'));
  const history = await client.callTool({ name: 'list_infographics', arguments: {} });
  assert.equal(history.structuredContent.count, 0);
  await client.close();
});

test('SDK client with a Client ID Metadata Document and a loopback redirect on a random port', async (t) => {
  const { __setCimdFetch } = await import('../../src/mcp/oauthServer.js');
  const clientId = 'https://sdk-client.example.test/oauth/client.json';
  __setCimdFetch(async (url) =>
    String(url) === clientId
      ? new Response(
          JSON.stringify({
            client_id: clientId,
            client_name: 'SDK CIMD Client',
            redirect_uris: ['http://127.0.0.1/callback'],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      : new Response('no', { status: 404 }),
  );
  t.after(() => __setCimdFetch(null));

  const browser = await signedInBrowser();
  const provider = new TestAuthProvider({ redirectUrl: 'http://127.0.0.1:50999/callback', clientMetadataUrl: clientId });
  const { client, consent } = await connectWithSdk(provider, browser);
  assert.equal(provider.authorizationUrl.searchParams.get('client_id'), clientId);
  assert.equal(consent.client.registration, 'metadata_document');
  assert.equal(consent.client.publishedBy, 'sdk-client.example.test');
  assert.equal(consent.client.loopbackOnly, true);
  const result = await client.callTool({ name: 'list_infographics', arguments: {} });
  assert.equal(result.isError, undefined);
  await client.close();
});

test('SDK client after the user revokes the connection: requests are refused', async () => {
  const browser = await signedInBrowser();
  const provider = new TestAuthProvider();
  const { client } = await connectWithSdk(provider, browser);
  const connections = await browser.get('/api/mcp/connections');
  const revoked = await browser.delete(`/api/mcp/connections/${connections.body.items[0].id}`);
  assert.equal(revoked.status, 200);
  await assert.rejects(client.callTool({ name: 'list_infographics', arguments: {} }));
  await client.close().catch(() => {});
});
