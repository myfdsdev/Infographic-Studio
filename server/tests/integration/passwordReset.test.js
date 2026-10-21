// Password reset: request, email delivery, single use, expiry, session revocation.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {
  startTestEnvironment,
  signupAgent,
  uniqueEmail,
  tokenFromResetEmail,
  STRONG_PASSWORD,
  OTHER_PASSWORD,
} from '../fixtures/testEnvironment.js';

let ctx;
before(async () => {
  ctx = await startTestEnvironment();
});
after(async () => {
  await ctx?.stop();
});
beforeEach(() => ctx.email.clearSentEmails());

async function requestReset(email) {
  return request(ctx.app).post('/api/auth/forgot-password').send({ email });
}

test('known and unknown emails get the identical response; only the real account gets an email', async () => {
  const { email } = await signupAgent(ctx.app);
  const known = await requestReset(email);
  const unknown = await requestReset(uniqueEmail('ghost'));
  assert.equal(known.status, 200);
  assert.equal(unknown.status, 200);
  assert.deepEqual(known.body, unknown.body);
  const sent = ctx.email.getSentEmails();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, email);
  assert.match(sent[0].subject, /reset/i);
  assert.match(sent[0].text, /^http:\/\/localhost:5173\/reset-password\?token=/m);
});

test('the reset token is stored only as an HMAC', async () => {
  const { email } = await signupAgent(ctx.app);
  await requestReset(email);
  const token = tokenFromResetEmail(ctx.email.getSentEmails()[0]);
  assert.ok(token);
  assert.equal(await ctx.models.PasswordResetToken.countDocuments({ tokenHash: token }), 0);
});

test('a valid reset changes the password, revokes all sessions, and cannot be reused', async () => {
  const { agent, email } = await signupAgent(ctx.app);
  assert.equal((await agent.get('/api/auth/me')).status, 200);
  await requestReset(email);
  const token = tokenFromResetEmail(ctx.email.getSentEmails()[0]);

  // A weak password is rejected before the token is consumed.
  const weak = await request(ctx.app).post('/api/auth/reset-password').send({ token, password: 'weak' });
  assert.equal(weak.status, 400);

  const ok = await request(ctx.app).post('/api/auth/reset-password').send({ token, password: OTHER_PASSWORD });
  assert.equal(ok.status, 200);

  assert.equal((await agent.get('/api/auth/me')).status, 401, 'existing session revoked');
  assert.equal((await request(ctx.app).post('/api/auth/login').send({ email, password: STRONG_PASSWORD })).status, 401);
  assert.equal((await request(ctx.app).post('/api/auth/login').send({ email, password: OTHER_PASSWORD })).status, 200);

  const reuse = await request(ctx.app).post('/api/auth/reset-password').send({ token, password: 'Another2026Pass' });
  assert.equal(reuse.status, 400);
  assert.equal(reuse.body.error.code, 'INVALID_RESET_TOKEN');
});

test('an expired reset link is rejected', async () => {
  const { email } = await signupAgent(ctx.app);
  await requestReset(email);
  const token = tokenFromResetEmail(ctx.email.getSentEmails()[0]);
  const user = await ctx.models.User.findOne({ email }).lean();
  await ctx.models.PasswordResetToken.updateMany({ userId: user._id }, { expiresAt: new Date(Date.now() - 1000) });
  const res = await request(ctx.app).post('/api/auth/reset-password').send({ token, password: OTHER_PASSWORD });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INVALID_RESET_TOKEN');
});

test('requesting a new link invalidates the previous one', async () => {
  const { email } = await signupAgent(ctx.app);
  await requestReset(email);
  await requestReset(email);
  const [first, second] = ctx.email.getSentEmails().map(tokenFromResetEmail);
  assert.notEqual(first, second);
  const old = await request(ctx.app).post('/api/auth/reset-password').send({ token: first, password: OTHER_PASSWORD });
  assert.equal(old.status, 400);
  const fresh = await request(ctx.app).post('/api/auth/reset-password').send({ token: second, password: OTHER_PASSWORD });
  assert.equal(fresh.status, 200);
});

test('garbage and missing tokens are rejected', async () => {
  const garbage = await request(ctx.app).post('/api/auth/reset-password').send({ token: 'x'.repeat(43), password: OTHER_PASSWORD });
  assert.equal(garbage.status, 400);
  const missing = await request(ctx.app).post('/api/auth/reset-password').send({ password: OTHER_PASSWORD });
  assert.equal(missing.status, 400);
});

test('reset requests and completions are audited without the token', async () => {
  const { email } = await signupAgent(ctx.app);
  await requestReset(email);
  const token = tokenFromResetEmail(ctx.email.getSentEmails()[0]);
  await request(ctx.app).post('/api/auth/reset-password').send({ token, password: OTHER_PASSWORD });
  const entries = await ctx.models.AuditLog.find({ actorEmail: email }).lean();
  const actions = entries.map((e) => e.action);
  assert.ok(actions.includes('auth.password_reset_requested'));
  assert.ok(actions.includes('auth.password_reset_completed'));
  const serialized = JSON.stringify(entries);
  assert.ok(!serialized.includes(token));
  assert.ok(!serialized.includes(OTHER_PASSWORD));
});
