// Sign in with Google: the OAuth flow, account rules and the settings that
// depend on how an account signs in. Google is replaced by tests/fixtures/mockGoogle.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {
  startTestEnvironment,
  signupAgent,
  loginAgent,
  createAdminAgent,
  uniqueEmail,
  sessionCookieFrom,
  STRONG_PASSWORD,
} from '../fixtures/testEnvironment.js';
import { startMockGoogle, GOOGLE_TEST_CLIENT_ID, GOOGLE_TEST_CLIENT_SECRET } from '../fixtures/mockGoogle.js';

const CLIENT = 'http://localhost:5173';
const REDIRECT_URI = `${CLIENT}/api/auth/google/callback`;

let ctx;
let google;
before(async () => {
  google = await startMockGoogle();
  google.state.redirectUri = REDIRECT_URI;
  ctx = await startTestEnvironment({
    GOOGLE_CLIENT_ID: GOOGLE_TEST_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: GOOGLE_TEST_CLIENT_SECRET,
    GOOGLE_AUTH_URL: 'https://accounts.google.test/o/oauth2/v2/auth',
    GOOGLE_TOKEN_URL: `${google.url}/token`,
    GOOGLE_JWKS_URL: `${google.url}/certs`,
  });
});
after(async () => {
  await ctx?.stop();
  await google?.close();
});

let subCounter = 0;
function googleUser(overrides = {}) {
  subCounter += 1;
  return { sub: `10${Date.now()}${subCounter}`, email: uniqueEmail('g'), name: 'Asha Creator', ...overrides };
}

/** Run the whole browser round trip and return the callback response. */
async function viaGoogle(agent, claims, { start = '/api/auth/google/start', codeOptions, mutate } = {}) {
  const started = await agent.get(start);
  assert.equal(started.status, 302, `start answered ${started.status}`);
  const authUrl = started.headers.location;
  const params = new URL(authUrl).searchParams;
  const code = google.issueCode(authUrl, claims, codeOptions);
  const query = new URLSearchParams({ code, state: params.get('state') });
  if (mutate) mutate(query);
  return agent.get(`/api/auth/google/callback?${query}`);
}

const landedOn = (res) => {
  assert.equal(res.status, 302);
  return res.headers.location;
};

test('the sign-in pages learn that Google is available', async () => {
  const res = await request(ctx.app).get('/api/auth/options');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { google: true, signupEnabled: true });
});

test('start sends the browser to Google with state, nonce and an S256 PKCE challenge', async () => {
  const res = await request(ctx.app).get('/api/auth/google/start');
  assert.equal(res.status, 302);
  const url = new URL(res.headers.location);
  assert.equal(url.origin + url.pathname, 'https://accounts.google.test/o/oauth2/v2/auth');
  const params = url.searchParams;
  assert.equal(params.get('client_id'), GOOGLE_TEST_CLIENT_ID);
  assert.equal(params.get('redirect_uri'), REDIRECT_URI);
  assert.equal(params.get('response_type'), 'code');
  assert.equal(params.get('scope'), 'openid email profile');
  assert.equal(params.get('code_challenge_method'), 'S256');
  assert.match(params.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
  assert.ok(params.get('state').length >= 40 && params.get('nonce').length >= 40);
  assert.equal(params.get('client_secret'), null);
  const cookie = (res.headers['set-cookie'] || []).find((c) => c.startsWith('iv_google='));
  assert.ok(cookie, 'flow cookie set');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.match(cookie, /Path=\/api\/auth\/google/);
  assert.ok(!cookie.includes(params.get('state')), 'the cookie is sealed, not the raw values');
});

test('a new Google account gets a regular user account without a password and is signed in', async () => {
  const agent = request.agent(ctx.app);
  const claims = googleUser({ name: 'Riya From Google' });
  const res = await viaGoogle(agent, claims);
  assert.equal(landedOn(res), `${CLIENT}/`);
  assert.ok(sessionCookieFrom(res), 'session cookie set');

  const me = await agent.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, claims.email);
  assert.equal(me.body.user.name, 'Riya From Google');
  assert.equal(me.body.user.role, 'user');

  const stored = await ctx.models.User.findOne({ email: claims.email }).select('+passwordHash').lean();
  assert.equal(stored.googleId, claims.sub);
  assert.equal(stored.passwordHash, null);
  const audit = await ctx.models.AuditLog.findOne({ action: 'auth.signup', targetEmail: claims.email }).lean();
  assert.equal(audit.metadata.method, 'google');
  // The secret never travels anywhere but Google's token endpoint.
  const sent = google.state.tokenRequests.at(-1);
  assert.equal(sent.client_secret, undefined);
  assert.equal(sent.redirect_uri, REDIRECT_URI);
  assert.ok(sent.code_verifier.length >= 43);
});

test('a returning Google user signs into the same account, even after changing their Gmail address', async () => {
  const claims = googleUser();
  await viaGoogle(request.agent(ctx.app), claims);
  const again = request.agent(ctx.app);
  const res = await viaGoogle(again, { ...claims, email: uniqueEmail('renamed') });
  assert.equal(landedOn(res), `${CLIENT}/`);
  assert.equal((await again.get('/api/auth/me')).body.user.email, claims.email);
  assert.equal(await ctx.models.User.countDocuments({ googleId: claims.sub }), 1);
});

test('returnTo keeps the user inside the app', async () => {
  const claims = googleUser();
  const good = await viaGoogle(request.agent(ctx.app), claims, { start: '/api/auth/google/start?returnTo=%2Fvideos%3Ftab%3Dall' });
  assert.equal(landedOn(good), `${CLIENT}/videos?tab=all`);
  for (const evil of ['//evil.example', 'https://evil.example', '/\\evil.example', 'videos']) {
    const res = await viaGoogle(request.agent(ctx.app), claims, { start: `/api/auth/google/start?returnTo=${encodeURIComponent(evil)}` });
    assert.equal(landedOn(res), `${CLIENT}/`, `refused ${evil}`);
  }
});

test('an email that already has a password account is not taken over by Google', async () => {
  const { email } = await signupAgent(ctx.app, { email: uniqueEmail('owner') });
  const agent = request.agent(ctx.app);
  const res = await viaGoogle(agent, googleUser({ email }));
  assert.equal(landedOn(res), `${CLIENT}/login?google=email_in_use`);
  assert.equal(sessionCookieFrom(res), null);
  const stored = await ctx.models.User.findOne({ email }).lean();
  assert.equal(stored.googleId, null);
  assert.equal(await ctx.models.User.countDocuments({ email }), 1);
});

test('forged, replayed or tampered answers are refused', async () => {
  const claims = googleUser();
  const refused = async (agent, options, expected) => {
    const res = await viaGoogle(agent, claims, options);
    assert.equal(landedOn(res), `${CLIENT}/login?google=${expected}`);
    assert.equal(sessionCookieFrom(res), null);
  };
  // Wrong state.
  await refused(request.agent(ctx.app), { mutate: (q) => q.set('state', 'x'.repeat(43)) }, 'expired');
  // Wrong nonce in the ID token.
  await refused(request.agent(ctx.app), { codeOptions: { nonce: 'not-the-nonce' } }, 'failed');
  // Signed with a key Google never published.
  await refused(request.agent(ctx.app), { codeOptions: { signWithStranger: true } }, 'failed');
  // Expired ID token.
  await refused(request.agent(ctx.app), { codeOptions: { expired: true } }, 'failed');
  // Token meant for another app.
  const wrongAudience = await viaGoogle(request.agent(ctx.app), { ...claims, aud: 'someone-else.apps.googleusercontent.com' });
  assert.equal(landedOn(wrongAudience), `${CLIENT}/login?google=failed`);
  // Unverified email.
  const unverified = await viaGoogle(request.agent(ctx.app), { ...claims, email_verified: false });
  assert.equal(landedOn(unverified), `${CLIENT}/login?google=unverified_email`);

  // No flow cookie at all (e.g. a link opened in another browser).
  const bare = await request(ctx.app).get('/api/auth/google/callback?code=abc&state=def');
  assert.equal(landedOn(bare), `${CLIENT}/login?google=expired`);
  // A forged cookie.
  const forged = await request(ctx.app)
    .get('/api/auth/google/callback?code=abc&state=def')
    .set('Cookie', 'iv_google=eyJtb2RlIjoibG9naW4ifQ.forged');
  assert.equal(landedOn(forged), `${CLIENT}/login?google=expired`);
  // Google says the user cancelled.
  const agent = request.agent(ctx.app);
  const started = await agent.get('/api/auth/google/start');
  const state = new URL(started.headers.location).searchParams.get('state');
  const cancelled = await agent.get(`/api/auth/google/callback?error=access_denied&state=${state}`);
  assert.equal(landedOn(cancelled), `${CLIENT}/login?google=cancelled`);
  assert.equal(await ctx.models.User.countDocuments({ googleId: claims.sub }), 0);

  // A finished answer cannot be replayed: the flow cookie is gone after one use.
  const replayer = request.agent(ctx.app);
  const begun = await replayer.get('/api/auth/google/start');
  const code = google.issueCode(begun.headers.location, googleUser());
  const callback = `/api/auth/google/callback?code=${code}&state=${new URL(begun.headers.location).searchParams.get('state')}`;
  assert.equal(landedOn(await replayer.get(callback)), `${CLIENT}/`);
  assert.equal(landedOn(await replayer.get(callback)), `${CLIENT}/login?google=expired`);
});

test('suspended accounts and closed sign-ups are respected', async () => {
  const claims = googleUser();
  await viaGoogle(request.agent(ctx.app), claims);
  await ctx.models.User.updateOne({ googleId: claims.sub }, { status: 'suspended' });
  const blocked = await viaGoogle(request.agent(ctx.app), claims);
  assert.equal(landedOn(blocked), `${CLIENT}/login?google=suspended`);

  const admin = await createAdminAgent(ctx.app, ctx.models, { email: uniqueEmail('admin') });
  await admin.agent.patch('/api/admin/settings').send({ access: { signupEnabled: false } }).expect(200);
  try {
    const closed = await viaGoogle(request.agent(ctx.app), googleUser());
    assert.equal(landedOn(closed), `${CLIENT}/login?google=signup_disabled`);
    assert.deepEqual((await request(ctx.app).get('/api/auth/options')).body, { google: true, signupEnabled: false });
    // Existing Google users can still sign in.
    const existing = googleUser();
    await ctx.models.User.create({ name: 'Existing', email: existing.email, googleId: existing.sub, googleEmail: existing.email });
    assert.equal(landedOn(await viaGoogle(request.agent(ctx.app), existing)), `${CLIENT}/`);
  } finally {
    await admin.agent.patch('/api/admin/settings').send({ access: { signupEnabled: true } }).expect(200);
  }
});

test('a signed-in password user connects Google in settings and can then sign in with it', async () => {
  const { agent, email } = await signupAgent(ctx.app, { email: uniqueEmail('linker') });
  let account = await agent.get('/api/settings/account');
  assert.deepEqual(account.body.signIn, { hasPassword: true, google: { available: true, connected: false, email: null } });

  const claims = googleUser({ email: uniqueEmail('personal') });
  const res = await viaGoogle(agent, claims, { start: '/api/auth/google/connect' });
  assert.equal(landedOn(res), `${CLIENT}/settings/account?google=connected`);
  account = await agent.get('/api/settings/account');
  assert.deepEqual(account.body.signIn.google, { available: true, connected: true, email: claims.email });

  const fresh = request.agent(ctx.app);
  assert.equal(landedOn(await viaGoogle(fresh, claims)), `${CLIENT}/`);
  assert.equal((await fresh.get('/api/auth/me')).body.user.email, email);

  // The same Google account cannot be connected to a second app account.
  const { agent: other } = await signupAgent(ctx.app, { email: uniqueEmail('other') });
  const taken = await viaGoogle(other, claims, { start: '/api/auth/google/connect' });
  assert.equal(landedOn(taken), `${CLIENT}/settings/account?google=already_linked`);

  // Connecting needs a signed-in user.
  assert.equal((await request(ctx.app).get('/api/auth/google/connect')).status, 401);

  // Disconnect works because the account has a password.
  const off = await agent.post('/api/settings/account/google/disconnect');
  assert.equal(off.status, 200);
  assert.equal(off.body.signIn.google.connected, false);
  const audit = await ctx.models.AuditLog.find({ targetEmail: email, action: /google/ }).lean();
  assert.deepEqual(audit.map((row) => row.action).sort(), ['account.google_connected', 'account.google_disconnected']);
});

test('an administrator acting as a user cannot connect Google to that account', async () => {
  const admin = await createAdminAgent(ctx.app, ctx.models, { email: uniqueEmail('admin') });
  const { user } = await signupAgent(ctx.app, { email: uniqueEmail('viewed') });
  await admin.agent.post(`/api/admin/users/${user.id}/act-as`).expect(200);
  const res = await admin.agent.get('/api/auth/google/connect');
  assert.equal(landedOn(res), `${CLIENT}/settings/account?google=not_allowed`);
  assert.equal((await ctx.models.User.findById(user.id).lean()).googleId, null);
  await admin.agent.post('/api/auth/act-as/stop').expect(200);
});

test('accounts made with Google: no password sign-in, first password, disconnect rule, delete by email', async () => {
  const agent = request.agent(ctx.app);
  const claims = googleUser();
  await viaGoogle(agent, claims);
  assert.equal((await agent.get('/api/settings/account')).body.signIn.hasPassword, false);

  // Nobody can sign in with a password the account does not have.
  const guess = await request(ctx.app).post('/api/auth/login').send({ email: claims.email, password: STRONG_PASSWORD });
  assert.equal(guess.status, 401);

  // Disconnecting would lock the owner out.
  const locked = await agent.post('/api/settings/account/google/disconnect');
  assert.equal(locked.status, 409);
  assert.equal(locked.body.error.code, 'PASSWORD_REQUIRED');

  // The signed-in owner sets a first password without a current one.
  const set = await agent.post('/api/settings/account/password').send({ newPassword: STRONG_PASSWORD });
  assert.equal(set.status, 200);
  assert.ok(await ctx.models.AuditLog.exists({ action: 'account.password_set', targetEmail: claims.email }));
  await loginAgent(ctx.app, { email: claims.email });
  // From now on the current password is required.
  const change = await agent.post('/api/settings/account/password').send({ newPassword: 'Another2026Pass' });
  assert.equal(change.status, 400);
  assert.equal(change.body.error.code, 'CURRENT_PASSWORD_INVALID');

  // A second Google-only account deletes itself by typing its email.
  const leaving = request.agent(ctx.app);
  const gone = googleUser();
  await viaGoogle(leaving, gone);
  const wrong = await leaving.post('/api/settings/account/delete').send({ confirmEmail: 'someone@else.test' });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error.code, 'CONFIRM_EMAIL_MISMATCH');
  assert.equal((await leaving.post('/api/settings/account/delete').send({ confirmEmail: gone.email.toUpperCase() })).status, 200);
  assert.equal(await ctx.models.User.countDocuments({ googleId: gone.sub }), 0);
});

test('admin user details say whether Google is connected', async () => {
  const admin = await createAdminAgent(ctx.app, ctx.models, { email: uniqueEmail('admin') });
  const claims = googleUser();
  await viaGoogle(request.agent(ctx.app), claims);
  const user = await ctx.models.User.findOne({ googleId: claims.sub }).lean();
  const details = await admin.agent.get(`/api/admin/users/${user._id}`);
  assert.equal(details.body.user.googleConnected, true);
  assert.equal(details.body.user.googleId, undefined, 'the Google id itself is not exposed');
});
