// "Act as user": an administrator sees the app as one user, read-only, for a
// limited time, and every start and end is audited.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestEnvironment,
  signupAgent,
  createAdminAgent,
  uniqueEmail,
} from '../fixtures/testEnvironment.js';

let ctx;
before(async () => {
  ctx = await startTestEnvironment();
});
after(async () => {
  await ctx?.stop();
});

const actAs = (admin, userId) => admin.agent.post(`/api/admin/users/${userId}/act-as`);
const stop = (agent) => agent.post('/api/auth/act-as/stop');

async function auditActions(targetId) {
  const rows = await ctx.models.AuditLog.find({ targetId: String(targetId), action: /^admin\.act_as/ })
    .sort({ createdAt: 1 })
    .lean();
  return rows.map((row) => ({ action: row.action, actorEmail: row.actorEmail, summary: row.summary }));
}

test('an admin sees the app as the user, then exits back to their own account', async () => {
  const admin = await createAdminAgent(ctx.app, ctx.models, { email: uniqueEmail('admin') });
  const { user } = await signupAgent(ctx.app, { name: 'Riya Creator' });

  const started = await actAs(admin, user.id);
  assert.equal(started.status, 200);
  assert.equal(started.body.user.id, user.id);
  assert.equal(started.body.actingAs.admin.id, admin.user.id);

  const me = await admin.agent.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.id, user.id);
  assert.equal(me.body.user.role, 'user');
  assert.equal(me.body.actingAs.admin.email, admin.user.email);
  const minutes = (new Date(me.body.actingAs.expiresAt) - new Date(me.body.actingAs.startedAt)) / 60000;
  assert.ok(minutes > 59 && minutes <= 60, `view lasts 60 minutes, got ${minutes}`);

  const account = await admin.agent.get('/api/settings/account');
  assert.equal(account.body.user.email, user.email);
  assert.equal((await admin.agent.get('/api/infographics')).status, 200);

  const ended = await stop(admin.agent);
  assert.equal(ended.status, 200);
  assert.equal(ended.body.user.id, admin.user.id);
  assert.equal(ended.body.viewedUserId, user.id);
  const back = await admin.agent.get('/api/auth/me');
  assert.equal(back.body.user.id, admin.user.id);
  assert.equal(back.body.actingAs, null);
  assert.equal((await admin.agent.get('/api/admin/stats')).status, 200);

  assert.deepEqual(
    (await auditActions(user.id)).map((row) => [row.action, row.actorEmail, row.summary]),
    [
      ['admin.act_as_started', admin.user.email, 'Viewing the app as this user, read-only, for up to 60 minutes'],
      ['admin.act_as_ended', admin.user.email, 'Exited'],
    ],
  );
});

test('while acting as a user nothing can be changed, and admin pages are closed', async () => {
  const admin = await createAdminAgent(ctx.app, ctx.models, { email: uniqueEmail('admin') });
  const { user } = await signupAgent(ctx.app);
  assert.equal((await actAs(admin, user.id)).status, 200);

  const writes = [
    () => admin.agent.patch('/api/settings/account').send({ name: 'Changed by admin' }),
    () => admin.agent.put('/api/settings/credentials/kie').send({ apiKey: 'kie_should_never_be_saved_1234567890' }),
    () => admin.agent.delete('/api/settings/credentials/kie'),
    () => admin.agent.post('/api/settings/sessions/revoke-others'),
    () => admin.agent.post('/api/settings/account/password').send({ currentPassword: 'x', newPassword: 'Another2026Pass' }),
    () => admin.agent.post('/api/settings/account/delete').send({ password: 'x' }),
    () => admin.agent.post('/api/jobs').send({}),
    () => admin.agent.post('/api/infographics').send({}),
  ];
  for (const write of writes) {
    const res = await write();
    assert.equal(res.status, 403, `${res.req.method} ${res.req.path} should be refused`);
    assert.equal(res.body.error.code, 'ACT_AS_READ_ONLY');
  }
  const stored = await ctx.models.User.findById(user.id).lean();
  assert.notEqual(stored.name, 'Changed by admin');
  assert.equal(await ctx.models.ApiCredential.countDocuments({ userId: user.id }), 0);

  // Admin routes see the user (a regular account), so they refuse.
  assert.equal((await admin.agent.get('/api/admin/stats')).status, 403);
  assert.equal((await admin.agent.get('/api/admin/users')).status, 403);
  // Starting a second view from inside one is refused too.
  const { user: other } = await signupAgent(ctx.app);
  assert.equal((await actAs(admin, other.id)).status, 403);

  assert.equal((await stop(admin.agent)).status, 200);
});

test("the user's key digits stay hidden from the administrator", async () => {
  const admin = await createAdminAgent(ctx.app, ctx.models, { email: uniqueEmail('admin') });
  const { agent, user } = await signupAgent(ctx.app);
  await ctx.models.ApiCredential.create({
    userId: user.id,
    provider: 'kie',
    encryptedKey: 'not-a-real-ciphertext',
    last4: '4321',
    status: 'valid',
  });
  assert.equal((await agent.get('/api/settings/credentials')).body.items[0].last4, '4321');

  await actAs(admin, user.id);
  const seen = await admin.agent.get('/api/settings/credentials');
  assert.equal(seen.status, 200);
  assert.equal(seen.body.items.length, 1);
  assert.equal(seen.body.items[0].status, 'valid');
  assert.equal(seen.body.items[0].last4, '');
  assert.ok(!JSON.stringify(seen.body).includes('4321'));
  await stop(admin.agent);
});

test('who can be viewed: not yourself, not admins, not suspended accounts, not by regular users', async () => {
  const admin = await createAdminAgent(ctx.app, ctx.models, { email: uniqueEmail('admin') });
  const otherAdmin = await createAdminAgent(ctx.app, ctx.models, { email: uniqueEmail('admin2') });
  const { user: suspended } = await signupAgent(ctx.app);
  await ctx.models.User.updateOne({ _id: suspended.id }, { status: 'suspended' });
  const { agent: regular, user: target } = await signupAgent(ctx.app);

  const self = await actAs(admin, admin.user.id);
  assert.equal(self.status, 400);
  assert.equal(self.body.error.code, 'ACT_AS_SELF');
  const adminTarget = await actAs(admin, otherAdmin.user.id);
  assert.equal(adminTarget.status, 403);
  assert.equal(adminTarget.body.error.code, 'ACT_AS_ADMIN');
  const suspendedTarget = await actAs(admin, suspended.id);
  assert.equal(suspendedTarget.status, 409);
  assert.equal(suspendedTarget.body.error.code, 'ACT_AS_SUSPENDED');
  assert.equal((await actAs(admin, '0123456789abcdef01234567')).status, 404);

  const byUser = await regular.post(`/api/admin/users/${target.id}/act-as`);
  assert.equal(byUser.status, 403);

  const notActing = await stop(admin.agent);
  assert.equal(notActing.status, 409);
  assert.equal(notActing.body.error.code, 'NOT_ACTING_AS');
  assert.equal((await admin.agent.get('/api/auth/me')).body.user.id, admin.user.id);
});

test('the view ends by itself when it expires or is no longer allowed, and the admin stays signed in', async () => {
  const admin = await createAdminAgent(ctx.app, ctx.models, { email: uniqueEmail('admin') });
  const sessionOf = () => ctx.models.Session.findOne({ userId: admin.user.id, revokedAt: null }).sort({ createdAt: -1 });

  // Expired.
  const { user: first } = await signupAgent(ctx.app);
  await actAs(admin, first.id);
  await ctx.models.Session.updateOne({ _id: (await sessionOf())._id }, { 'actingAs.expiresAt': new Date(Date.now() - 1000) });
  let me = await admin.agent.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.id, admin.user.id);
  assert.equal(me.body.actingAs, null);
  assert.equal((await sessionOf()).actingAs, null);
  assert.equal((await auditActions(first.id)).at(-1).summary, 'Ended after 60 minutes');

  // The user is suspended mid-view: the admin's session must survive.
  const { user: second } = await signupAgent(ctx.app);
  await actAs(admin, second.id);
  await ctx.models.User.updateOne({ _id: second.id }, { status: 'suspended' });
  me = await admin.agent.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.id, admin.user.id);
  assert.equal((await auditActions(second.id)).at(-1).summary, 'Ended: the account was suspended');

  // The user is deleted mid-view.
  const { user: third } = await signupAgent(ctx.app);
  await actAs(admin, third.id);
  await ctx.models.User.deleteOne({ _id: third.id });
  me = await admin.agent.get('/api/auth/me');
  assert.equal(me.body.user.id, admin.user.id);

  // The administrator loses the role mid-view.
  const { user: fourth } = await signupAgent(ctx.app);
  await actAs(admin, fourth.id);
  await ctx.models.User.updateOne({ _id: admin.user.id }, { role: 'user' });
  me = await admin.agent.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.id, admin.user.id);
  assert.equal(me.body.user.role, 'user');
  assert.equal(me.body.actingAs, null);
  assert.equal((await auditActions(fourth.id)).at(-1).summary, 'Ended: the administrator role was removed');
});

test('signing out while acting as a user signs the administrator out', async () => {
  const admin = await createAdminAgent(ctx.app, ctx.models, { email: uniqueEmail('admin') });
  const { user } = await signupAgent(ctx.app);
  await actAs(admin, user.id);

  const out = await admin.agent.post('/api/auth/logout');
  assert.equal(out.status, 200);
  assert.equal((await admin.agent.get('/api/auth/me')).status, 401);

  const logoutRow = await ctx.models.AuditLog.findOne({ action: 'auth.logout', targetId: String(admin.user.id) }).lean();
  assert.ok(logoutRow, 'the sign-out is recorded against the administrator');
  assert.equal(logoutRow.actorEmail, admin.user.email);
  assert.equal(await ctx.models.AuditLog.countDocuments({ action: 'auth.logout', targetId: String(user.id) }), 0);
  assert.equal((await auditActions(user.id)).at(-1).summary, 'Ended: signed out');
  // The user's own sessions are untouched.
  assert.equal(await ctx.models.Session.countDocuments({ userId: user.id, revokedAt: null }), 1);
});
