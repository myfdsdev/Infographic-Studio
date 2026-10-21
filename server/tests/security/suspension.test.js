// Suspension blocks access everywhere, including sessions that already exist.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {
  startTestEnvironment,
  signupAgent,
  createAdminAgent,
  loginAgent,
  tokenFromResetEmail,
  STRONG_PASSWORD,
  OTHER_PASSWORD,
} from '../fixtures/testEnvironment.js';

let ctx;
let admin;
before(async () => {
  ctx = await startTestEnvironment();
  admin = await createAdminAgent(ctx.app, ctx.models);
});
after(async () => {
  await ctx?.stop();
});
beforeEach(() => ctx.email.clearSentEmails());

test('suspending a user cuts off every existing session immediately', async () => {
  const { agent: browserA, user, email } = await signupAgent(ctx.app);
  const { agent: browserB } = await loginAgent(ctx.app, { email });
  assert.equal((await browserA.get('/api/auth/me')).status, 200);
  assert.equal((await browserB.get('/api/settings/sessions')).status, 200);

  const res = await admin.agent.patch(`/api/admin/users/${user.id}`).send({ status: 'suspended', reason: 'Spam reports' });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.status, 'suspended');
  assert.equal(res.body.sessionsRevoked, 2);

  const blockedA = await browserA.get('/api/auth/me');
  assert.ok([401, 403].includes(blockedA.status));
  const blockedB = await browserB.get('/api/settings/sessions');
  assert.ok([401, 403].includes(blockedB.status));
  const active = await ctx.models.Session.countDocuments({ userId: user.id, revokedAt: null });
  assert.equal(active, 0);
});

test('a session that survived (e.g. created in a race) is still refused while suspended', async () => {
  const { user, email } = await signupAgent(ctx.app);
  const { agent } = await loginAgent(ctx.app, { email });
  // Flip the status directly, without the admin flow that revokes sessions,
  // to prove the per-request status check alone blocks access.
  await ctx.models.User.updateOne({ _id: user.id }, { status: 'suspended' });
  const res = await agent.get('/api/auth/me');
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'ACCOUNT_SUSPENDED');
  const after = await agent.get('/api/auth/me');
  assert.equal(after.status, 401, 'the session was revoked on first refusal');
});

test('a suspended user cannot sign in, and a wrong password reveals nothing extra', async () => {
  const { user, email } = await signupAgent(ctx.app);
  await admin.agent.patch(`/api/admin/users/${user.id}`).send({ status: 'suspended' });
  const right = await request(ctx.app).post('/api/auth/login').send({ email, password: STRONG_PASSWORD });
  assert.equal(right.status, 403);
  assert.equal(right.body.error.code, 'ACCOUNT_SUSPENDED');
  const wrong = await request(ctx.app).post('/api/auth/login').send({ email, password: 'Wrong123456' });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.error.code, 'INVALID_CREDENTIALS');
});

test('suspension voids outstanding reset links and blocks new ones', async () => {
  const { user, email } = await signupAgent(ctx.app);
  await request(ctx.app).post('/api/auth/forgot-password').send({ email });
  const token = tokenFromResetEmail(ctx.email.getSentEmails()[0]);
  await admin.agent.patch(`/api/admin/users/${user.id}`).send({ status: 'suspended' });

  const reset = await request(ctx.app).post('/api/auth/reset-password').send({ token, password: OTHER_PASSWORD });
  assert.equal(reset.status, 400);

  ctx.email.clearSentEmails();
  const again = await request(ctx.app).post('/api/auth/forgot-password').send({ email });
  assert.equal(again.status, 200);
  assert.equal(ctx.email.getSentEmails().length, 0);
});

test('reactivation restores sign-in; old sessions stay revoked; both actions are audited', async () => {
  const { agent: oldBrowser, user, email } = await signupAgent(ctx.app);
  await admin.agent.patch(`/api/admin/users/${user.id}`).send({ status: 'suspended', reason: 'Investigating' });
  const reactivate = await admin.agent.patch(`/api/admin/users/${user.id}`).send({ status: 'active' });
  assert.equal(reactivate.status, 200);
  assert.equal(reactivate.body.user.status, 'active');
  assert.equal(reactivate.body.user.suspendedAt, null);

  assert.equal((await oldBrowser.get('/api/auth/me')).status, 401);
  const login = await request(ctx.app).post('/api/auth/login').send({ email, password: STRONG_PASSWORD });
  assert.equal(login.status, 200);

  const audit = await ctx.models.AuditLog.find({ targetId: user.id, area: 'admin' }).sort({ createdAt: 1 }).lean();
  assert.deepEqual(
    audit.map((e) => e.action),
    ['admin.user_suspended', 'admin.user_reactivated'],
  );
  assert.equal(audit[0].metadata.reason, 'Investigating');
  assert.equal(audit[0].actorEmail, admin.user.email);
});

test('a suspended administrator loses admin access too', async () => {
  const other = await createAdminAgent(ctx.app, ctx.models);
  assert.equal((await other.agent.get('/api/admin/stats')).status, 200);
  await admin.agent.patch(`/api/admin/users/${other.user.id}`).send({ status: 'suspended' });
  const res = await other.agent.get('/api/admin/stats');
  assert.ok([401, 403].includes(res.status));
});

test('loadActiveUser (shared by every auth path, including future MCP tokens) refuses suspended users', async () => {
  const { loadActiveUser } = await import('../../src/services/auth.service.js');
  const { user } = await signupAgent(ctx.app);
  const active = await loadActiveUser(user.id);
  assert.equal(String(active._id), user.id);
  await ctx.models.User.updateOne({ _id: user.id }, { status: 'suspended' });
  await assert.rejects(() => loadActiveUser(user.id), (error) => error.code === 'ACCOUNT_SUSPENDED');
});
