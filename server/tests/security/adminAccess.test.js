// Unauthorized admin access and role escalation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {
  startTestEnvironment,
  signupAgent,
  createAdminAgent,
  uniqueEmail,
  STRONG_PASSWORD,
} from '../fixtures/testEnvironment.js';

let ctx;
before(async () => {
  ctx = await startTestEnvironment();
});
after(async () => {
  await ctx?.stop();
});

const ADMIN_GETS = ['/api/admin/stats', '/api/admin/users', '/api/admin/audit-logs'];

test('anonymous callers get 401 on every admin route', async () => {
  for (const path of ADMIN_GETS) {
    const res = await request(ctx.app).get(path);
    assert.equal(res.status, 401, path);
  }
  const patch = await request(ctx.app).patch('/api/admin/users/0123456789abcdef01234567').send({ status: 'suspended' });
  assert.equal(patch.status, 401);
});

test('signed-in non-admins get 403 on every admin route', async () => {
  const { agent, user } = await signupAgent(ctx.app);
  for (const path of ADMIN_GETS) {
    const res = await agent.get(path);
    assert.equal(res.status, 403, path);
  }
  assert.equal((await agent.get(`/api/admin/users/${user.id}`)).status, 403);
  const selfPromote = await agent.patch(`/api/admin/users/${user.id}`).send({ role: 'admin' });
  assert.equal(selfPromote.status, 403);
  const stored = await ctx.models.User.findById(user.id).lean();
  assert.equal(stored.role, 'user');
});

test('administrators can use the admin routes', async () => {
  const { agent } = await createAdminAgent(ctx.app, ctx.models);
  for (const path of ADMIN_GETS) {
    const res = await agent.get(path);
    assert.equal(res.status, 200, path);
  }
});

test('sign-up cannot set role, status or other privileged fields', async () => {
  for (const extra of [{ role: 'admin' }, { status: 'active' }, { isAdmin: true }]) {
    const email = uniqueEmail('escalate');
    const res = await request(ctx.app)
      .post('/api/auth/signup')
      .send({ name: 'Mallory', email, password: STRONG_PASSWORD, ...extra });
    assert.equal(res.status, 400, JSON.stringify(extra));
    assert.equal(await ctx.models.User.countDocuments({ email }), 0);
  }
});

test('the account endpoint rejects role, status and email changes', async () => {
  const { agent, user } = await signupAgent(ctx.app);
  for (const body of [{ name: 'Mallory', role: 'admin' }, { status: 'active' }, { email: 'other@example.test' }, { role: 'admin' }]) {
    const res = await agent.patch('/api/settings/account').send(body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  const me = await agent.get('/api/auth/me');
  assert.equal(me.body.user.role, 'user');
  assert.equal((await ctx.models.User.findById(user.id).lean()).role, 'user');
  const ok = await agent.patch('/api/settings/account').send({ name: 'Renamed' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.name, 'Renamed');
});

test('login cannot be used to smuggle a role either', async () => {
  const { email } = await signupAgent(ctx.app);
  const res = await request(ctx.app).post('/api/auth/login').send({ email, password: STRONG_PASSWORD, role: 'admin' });
  assert.equal(res.status, 400);
});

test('admins cannot change their own role or status', async () => {
  const { agent, user } = await createAdminAgent(ctx.app, ctx.models);
  const demote = await agent.patch(`/api/admin/users/${user.id}`).send({ role: 'user' });
  assert.equal(demote.status, 400);
  assert.equal(demote.body.error.code, 'SELF_MODIFICATION');
  const suspend = await agent.patch(`/api/admin/users/${user.id}`).send({ status: 'suspended' });
  assert.equal(suspend.status, 400);
});

test('role changes by an admin take effect on the very next request', async () => {
  const { agent: admin } = await createAdminAgent(ctx.app, ctx.models);
  const { agent: target, user } = await signupAgent(ctx.app);
  assert.equal((await target.get('/api/admin/stats')).status, 403);

  const promote = await admin.patch(`/api/admin/users/${user.id}`).send({ role: 'admin' });
  assert.equal(promote.status, 200);
  assert.equal((await target.get('/api/admin/stats')).status, 200, 'existing session gains access');

  const demote = await admin.patch(`/api/admin/users/${user.id}`).send({ role: 'user' });
  assert.equal(demote.status, 200);
  assert.equal((await target.get('/api/admin/stats')).status, 403, 'existing session loses access');

  const audit = await ctx.models.AuditLog.find({ targetId: user.id, action: 'admin.user_role_changed' }).lean();
  assert.equal(audit.length, 2);
});

test('the only active administrator cannot delete their own account', async () => {
  await ctx.models.User.updateMany({ role: 'admin' }, { role: 'user' });
  const { agent, password } = await createAdminAgent(ctx.app, ctx.models);
  const res = await agent.post('/api/settings/account/delete').send({ password: password || STRONG_PASSWORD });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'LAST_ADMIN');
});

test('admin request validation rejects unknown fields and bad ids', async () => {
  const { agent } = await createAdminAgent(ctx.app, ctx.models);
  const { user } = await signupAgent(ctx.app);
  const extra = await agent.patch(`/api/admin/users/${user.id}`).send({ status: 'suspended', passwordHash: 'x' });
  assert.equal(extra.status, 400);
  const empty = await agent.patch(`/api/admin/users/${user.id}`).send({});
  assert.equal(empty.status, 400);
  const badId = await agent.get('/api/admin/users/not-an-id');
  assert.equal(badId.status, 400);
  const missing = await agent.get('/api/admin/users/0123456789abcdef01234567');
  assert.equal(missing.status, 404);
});
