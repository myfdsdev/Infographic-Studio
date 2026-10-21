// Admin user search, details, stats and audit-log listing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestEnvironment, signupAgent, createAdminAgent, STRONG_PASSWORD } from '../fixtures/testEnvironment.js';

let ctx;
let admin;
let priya;
before(async () => {
  ctx = await startTestEnvironment();
  admin = await createAdminAgent(ctx.app, ctx.models, { email: 'owner@example.test' });
  priya = await signupAgent(ctx.app, { name: 'Priya Sharma', email: 'priya.sharma@example.test' });
  await signupAgent(ctx.app, { name: 'Rahul Verma', email: 'rahul@example.test' });
  await signupAgent(ctx.app, { name: 'Sam Lee', email: 'sam@example.test' });
});
after(async () => {
  await ctx?.stop();
});

test('search matches name or email, case-insensitively', async () => {
  const byName = await admin.agent.get('/api/admin/users').query({ search: 'PRIYA' });
  assert.equal(byName.status, 200);
  assert.deepEqual(byName.body.items.map((u) => u.email), ['priya.sharma@example.test']);
  const byEmail = await admin.agent.get('/api/admin/users').query({ search: 'rahul@' });
  assert.equal(byEmail.body.items.length, 1);
});

test('regex characters in the search are treated literally', async () => {
  const res = await admin.agent.get('/api/admin/users').query({ search: '.*(' });
  assert.equal(res.status, 200);
  assert.equal(res.body.items.length, 0);
});

test('filters and pagination work and never expose password hashes', async () => {
  const admins = await admin.agent.get('/api/admin/users').query({ role: 'admin' });
  assert.ok(admins.body.items.every((u) => u.role === 'admin'));
  const page = await admin.agent.get('/api/admin/users').query({ limit: 2, page: 1 });
  assert.equal(page.body.items.length, 2);
  assert.equal(page.body.total, 4, "admin + 3 users before later tests add more");
  const serialized = JSON.stringify(page.body);
  assert.ok(!serialized.includes('passwordHash'));
  assert.ok(!serialized.includes('scrypt$'));
});

test('user details include session count and recent activity', async () => {
  const res = await admin.agent.get(`/api/admin/users/${priya.user.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.user.email, 'priya.sharma@example.test');
  assert.equal(res.body.activeSessions, 1);
  assert.ok(res.body.recentActivity.some((entry) => entry.action === 'auth.signup'));
  assert.ok(!JSON.stringify(res.body).includes('passwordHash'));
});

test('stats are real counts', async () => {
  await admin.agent.patch(`/api/admin/users/${priya.user.id}`).send({ status: 'suspended', reason: 'Test' });
  const res = await admin.agent.get('/api/admin/stats');
  assert.equal(res.status, 200);
  assert.deepEqual(
    { total: res.body.stats.totalUsers, active: res.body.stats.activeUsers, suspended: res.body.stats.suspendedUsers, admins: res.body.stats.admins },
    { total: 4, active: 3, suspended: 1, admins: 1 },
  );
  await admin.agent.patch(`/api/admin/users/${priya.user.id}`).send({ status: 'active' });
});

test('status filter returns suspended accounts only', async () => {
  await admin.agent.patch(`/api/admin/users/${priya.user.id}`).send({ status: 'suspended' });
  const res = await admin.agent.get('/api/admin/users').query({ status: 'suspended' });
  assert.deepEqual(res.body.items.map((u) => u.email), ['priya.sharma@example.test']);
  await admin.agent.patch(`/api/admin/users/${priya.user.id}`).send({ status: 'active' });
});

test('audit logs can be searched and filtered by area, and contain no secrets', async () => {
  // A fresh account: earlier tests suspended Priya, which revoked her sessions.
  const changer = await signupAgent(ctx.app, { name: 'Changer' });
  const changed = await changer.agent
    .post('/api/settings/account/password')
    .send({ currentPassword: STRONG_PASSWORD, newPassword: 'Changed2026Pass' });
  assert.equal(changed.status, 200);
  const all = await admin.agent.get('/api/admin/audit-logs');
  assert.equal(all.status, 200);
  assert.ok(all.body.total > 0);
  const adminArea = await admin.agent.get('/api/admin/audit-logs').query({ area: 'admin' });
  assert.ok(adminArea.body.items.length > 0);
  assert.ok(adminArea.body.items.every((e) => e.area === 'admin'));
  const search = await admin.agent.get('/api/admin/audit-logs').query({ search: 'password_changed' });
  assert.ok(search.body.items.some((e) => e.action === 'account.password_changed'));
  const serialized = JSON.stringify(all.body);
  assert.ok(!serialized.includes(STRONG_PASSWORD));
  assert.ok(!serialized.includes('Changed2026Pass'));
});
