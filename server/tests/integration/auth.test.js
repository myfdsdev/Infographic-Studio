// Sign-up, login, logout, sessions and cookies against a real MongoDB.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {
  startTestEnvironment,
  signupAgent,
  uniqueEmail,
  sessionCookieFrom,
  STRONG_PASSWORD,
} from '../fixtures/testEnvironment.js';

let ctx;
before(async () => {
  ctx = await startTestEnvironment();
});
after(async () => {
  await ctx?.stop();
});

test('the first public sign-up is a normal user, never an admin', async () => {
  assert.equal(await ctx.models.User.countDocuments({}), 0);
  const { user } = await signupAgent(ctx.app, { email: uniqueEmail('first') });
  assert.equal(user.role, 'user');
  const stored = await ctx.models.User.findById(user.id).lean();
  assert.equal(stored.role, 'user');
});

test('sign-up sets an httpOnly SameSite session cookie and returns only public fields', async () => {
  const email = uniqueEmail('signup');
  const res = await request(ctx.app).post('/api/auth/signup').send({ name: 'Maya', email, password: STRONG_PASSWORD });
  assert.equal(res.status, 201);
  const cookie = sessionCookieFrom(res);
  assert.ok(cookie, 'session cookie set');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.match(cookie, /Path=\//);
  assert.deepEqual(Object.keys(res.body.user).sort(), ['createdAt', 'email', 'id', 'lastLoginAt', 'name', 'role', 'status']);
  assert.equal(res.body.user.email, email);
  assert.ok(!JSON.stringify(res.body).includes('passwordHash'));
});

test('passwords are stored as scrypt hashes, never in plain text', async () => {
  const email = uniqueEmail('hash');
  await signupAgent(ctx.app, { email });
  const stored = await ctx.models.User.findOne({ email }).select('+passwordHash').lean();
  assert.match(stored.passwordHash, /^scrypt\$\d+\$\d+\$\d+\$/);
  assert.ok(!stored.passwordHash.includes(STRONG_PASSWORD));
});

test('session tokens are stored only as HMACs', async () => {
  const email = uniqueEmail('token');
  const res = await request(ctx.app).post('/api/auth/signup').send({ name: 'Token', email, password: STRONG_PASSWORD });
  const raw = sessionCookieFrom(res).split(';')[0].split('=')[1];
  const user = await ctx.models.User.findOne({ email }).lean();
  const session = await ctx.models.Session.findOne({ userId: user._id }).lean();
  assert.notEqual(session.tokenHash, raw);
  assert.equal(await ctx.models.Session.countDocuments({ tokenHash: raw }), 0);
});

test('duplicate email (any case) is rejected with 409', async () => {
  const email = uniqueEmail('dup');
  await signupAgent(ctx.app, { email });
  const res = await request(ctx.app).post('/api/auth/signup').send({ name: 'Again', email: email.toUpperCase(), password: STRONG_PASSWORD });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'EMAIL_TAKEN');
});

test('weak passwords and bad emails are rejected with field details', async () => {
  const weak = await request(ctx.app).post('/api/auth/signup').send({ name: 'Weak', email: uniqueEmail('weak'), password: 'short' });
  assert.equal(weak.status, 400);
  assert.ok(weak.body.error.details.password);
  const noDigit = await request(ctx.app).post('/api/auth/signup').send({ name: 'Weak', email: uniqueEmail('weak'), password: 'onlyletterspassword' });
  assert.equal(noDigit.status, 400);
  const badEmail = await request(ctx.app).post('/api/auth/signup').send({ name: 'Bad', email: 'not-an-email', password: STRONG_PASSWORD });
  assert.equal(badEmail.status, 400);
  assert.ok(badEmail.body.error.details.email);
});

test('GET /auth/me requires a session', async () => {
  const anon = await request(ctx.app).get('/api/auth/me');
  assert.equal(anon.status, 401);
  const { agent, email } = await signupAgent(ctx.app);
  const me = await agent.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, email);
});

test('login: wrong password and unknown email give the same generic 401', async () => {
  const { email } = await signupAgent(ctx.app);
  const wrong = await request(ctx.app).post('/api/auth/login').send({ email, password: 'Wrong123456' });
  const unknown = await request(ctx.app).post('/api/auth/login').send({ email: uniqueEmail('nobody'), password: 'Wrong123456' });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(wrong.body.error.code, 'INVALID_CREDENTIALS');
  assert.equal(wrong.body.error.message, unknown.body.error.message);
  assert.equal(sessionCookieFrom(wrong), null);
});

test('login succeeds with the right password; remember=false gives a browser-session cookie', async () => {
  const { email } = await signupAgent(ctx.app);
  const remembered = await request(ctx.app).post('/api/auth/login').send({ email, password: STRONG_PASSWORD });
  assert.equal(remembered.status, 200);
  assert.match(sessionCookieFrom(remembered), /Expires=/i);
  const shortLived = await request(ctx.app).post('/api/auth/login').send({ email, password: STRONG_PASSWORD, remember: false });
  assert.equal(shortLived.status, 200);
  assert.doesNotMatch(sessionCookieFrom(shortLived), /Expires=/i);
  const user = await ctx.models.User.findOne({ email }).lean();
  assert.ok(user.lastLoginAt);
});

test('logout revokes the session server-side (a replayed cookie stops working)', async () => {
  const { email } = await signupAgent(ctx.app);
  const login = await request(ctx.app).post('/api/auth/login').send({ email, password: STRONG_PASSWORD });
  const cookie = sessionCookieFrom(login).split(';')[0];
  assert.equal((await request(ctx.app).get('/api/auth/me').set('Cookie', cookie)).status, 200);
  const out = await request(ctx.app).post('/api/auth/logout').set('Cookie', cookie);
  assert.equal(out.status, 200);
  const replay = await request(ctx.app).get('/api/auth/me').set('Cookie', cookie);
  assert.equal(replay.status, 401);
});

test('a forged or malformed session cookie is rejected', async () => {
  const res = await request(ctx.app).get('/api/auth/me').set('Cookie', 'iv_session=forged-token-value-that-is-long-enough');
  assert.equal(res.status, 401);
  const weird = await request(ctx.app).get('/api/auth/me').set('Cookie', 'iv_session=%7B%22%24ne%22%3Anull%7D');
  assert.equal(weird.status, 401);
});

test('cross-site POSTs from a disallowed origin are refused (CSRF defence)', async () => {
  const { email } = await signupAgent(ctx.app);
  const res = await request(ctx.app)
    .post('/api/auth/login')
    .set('Origin', 'https://evil.example')
    .send({ email, password: STRONG_PASSWORD });
  assert.equal(res.status, 403);
  assert.equal(sessionCookieFrom(res), null);
});

test('sign-up, login success and login failure are written to the audit log', async () => {
  const { email } = await signupAgent(ctx.app);
  await request(ctx.app).post('/api/auth/login').send({ email, password: 'Wrong123456' });
  await request(ctx.app).post('/api/auth/login').send({ email, password: STRONG_PASSWORD });
  const entries = await ctx.models.AuditLog.find({ actorEmail: email }).lean();
  const actions = entries.map((e) => `${e.action}:${e.outcome}`);
  assert.ok(actions.includes('auth.signup:success'));
  assert.ok(actions.includes('auth.login:failure'));
  assert.ok(actions.includes('auth.login:success'));
  assert.ok(!JSON.stringify(entries).includes(STRONG_PASSWORD));
});

test('without Google credentials the sign-in pages offer no Google button and the flow is closed', async () => {
  const options = await request(ctx.app).get('/api/auth/options');
  assert.equal(options.status, 200);
  assert.equal(options.body.google, false);
  const start = await request(ctx.app).get('/api/auth/google/start');
  assert.equal(start.status, 302);
  assert.equal(start.headers.location, 'http://localhost:5173/login?google=unavailable');
  assert.equal((start.headers['set-cookie'] || []).length, 0);
});
