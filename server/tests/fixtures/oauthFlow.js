// Drive the OAuth flow the way an MCP client and the user's browser do,
// against the in-process app (supertest). The signed-in user's agent plays
// the browser: it carries the app session cookie and the authorization
// server's own cookies.
import crypto from 'node:crypto';
import request from 'supertest';

export const CLAUDE_CALLBACK = 'https://claude.ai/api/mcp/auth_callback';

export function pkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/** Path + query of an absolute URL, for supertest. */
export function pathOf(url) {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

export async function registerClient(app, overrides = {}) {
  const res = await request(app)
    .post('/oauth/register')
    .set('Content-Type', 'application/json')
    .send({
      client_name: 'Test AI App',
      redirect_uris: [CLAUDE_CALLBACK],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      ...overrides,
    });
  if (res.status !== 201) throw new Error(`registration failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

export function authorizeQuery({ clientId, redirectUri = CLAUDE_CALLBACK, scope, resource, challenge, state = 'st4te', method = 'S256' }) {
  const params = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state });
  if (challenge) {
    params.set('code_challenge', challenge);
    params.set('code_challenge_method', method);
  }
  if (scope !== undefined) params.set('scope', scope);
  if (resource !== undefined) params.set('resource', resource);
  return `/oauth/authorize?${params.toString()}`;
}

/** Start an authorization request in `browser`; returns the consent uid. */
export async function startAuthorization(browser, options) {
  const res = await browser.get(authorizeQuery(options));
  if (res.status !== 303) throw new Error(`authorize did not redirect to consent: ${res.status} ${res.text?.slice(0, 300)}`);
  const location = new URL(res.headers.location);
  return { uid: location.searchParams.get('uid'), consentUrl: res.headers.location };
}

/** Follow the resume URL in `browser` and return the redirect to the client. */
export async function resume(browser, redirectTo) {
  const res = await browser.get(pathOf(redirectTo));
  if (res.status !== 303) throw new Error(`resume did not redirect: ${res.status} ${res.text?.slice(0, 300)}`);
  return new URL(res.headers.location);
}

/** Full happy path: authorize, approve on the consent page, resume, return code. */
export async function authorizeAndApprove(browser, { clientId, scopes, redirectUri = CLAUDE_CALLBACK, resource, scope }) {
  const { verifier, challenge } = pkcePair();
  const { uid } = await startAuthorization(browser, { clientId, redirectUri, challenge, resource, scope });
  const consent = await browser.get(`/api/oauth/interactions/${uid}`);
  if (consent.status !== 200) throw new Error(`consent details failed: ${consent.status} ${JSON.stringify(consent.body)}`);
  const approved = await browser
    .post(`/api/oauth/interactions/${uid}/approve`)
    .send({ scopes: scopes || consent.body.scopes.map((item) => item.id) });
  if (approved.status !== 200) throw new Error(`approve failed: ${approved.status} ${JSON.stringify(approved.body)}`);
  const callback = await resume(browser, approved.body.redirectTo);
  return { code: callback.searchParams.get('code'), callback, verifier, uid, consent: consent.body, connection: approved.body.connection };
}

export async function exchangeCode(app, { clientId, code, verifier, redirectUri = CLAUDE_CALLBACK, resource }) {
  const form = new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: redirectUri });
  if (verifier) form.set('code_verifier', verifier);
  if (resource) form.set('resource', resource);
  return request(app).post('/oauth/token').type('form').send(form.toString());
}

export async function refresh(app, { clientId, refreshToken, resource }) {
  const form = new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken });
  if (resource) form.set('resource', resource);
  return request(app).post('/oauth/token').type('form').send(form.toString());
}

/** Register, authorize, approve and exchange: returns tokens for `browser`'s user. */
export async function connect(app, browser, { scopes, resource, clientOverrides } = {}) {
  const client = await registerClient(app, clientOverrides);
  const flow = await authorizeAndApprove(browser, { clientId: client.client_id, scopes, resource });
  const token = await exchangeCode(app, { clientId: client.client_id, code: flow.code, verifier: flow.verifier, resource });
  if (token.status !== 200) throw new Error(`token exchange failed: ${token.status} ${JSON.stringify(token.body)}`);
  return { client, flow, tokens: token.body, connection: flow.connection };
}

let rpcId = 0;
/** One JSON-RPC message to /mcp with a bearer token (2025-era stateless form). */
export function mcpPost(app, token, message) {
  rpcId += 1;
  const req = request(app)
    .post('/mcp')
    .set('Accept', 'application/json, text/event-stream')
    .set('Content-Type', 'application/json')
    .set('MCP-Protocol-Version', '2025-06-18');
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req.send({ jsonrpc: '2.0', id: rpcId, ...message });
}

/** Parse a JSON or single-event SSE response body from /mcp. */
export function rpcBody(res) {
  if (res.body && typeof res.body === 'object' && Object.keys(res.body).length) return res.body;
  const text = res.text || '';
  const data = text
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .pop();
  return data ? JSON.parse(data) : null;
}

export async function callTool(app, token, name, args = {}) {
  const res = await mcpPost(app, token, { method: 'tools/call', params: { name, arguments: args } });
  return { res, body: rpcBody(res) };
}
