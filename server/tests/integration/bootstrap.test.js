// One-time owner/admin bootstrap.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import mongoose from 'mongoose';
import { startTestEnvironment, signupAgent, STRONG_PASSWORD } from '../fixtures/testEnvironment.js';

const ADMIN_PASSWORD = 'OwnerStrong2026Key';

let ctx;
let runBootstrap;
before(async () => {
  ctx = await startTestEnvironment();
  ({ runBootstrap } = await import('../../scripts/bootstrapAdmin.js'));
});
after(async () => {
  await ctx?.stop();
});
beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  await ctx.models.ensureIndexes();
});

test('refuses mismatched emails, invalid emails and weak or default-style passwords', async () => {
  await assert.rejects(
    () => runBootstrap({ email: 'owner@example.test', confirmEmail: 'other@example.test', password: ADMIN_PASSWORD }),
    /do not match/,
  );
  await assert.rejects(() => runBootstrap({ email: 'nope', confirmEmail: 'nope', password: ADMIN_PASSWORD }), /valid/);
  await assert.rejects(
    () => runBootstrap({ email: 'owner@example.test', confirmEmail: 'owner@example.test', password: 'Short1' }),
    /at least 12/,
  );
  await assert.rejects(
    () => runBootstrap({ email: 'owner@example.test', confirmEmail: 'owner@example.test', password: undefined }),
    /rejected/,
  );
  assert.equal(await ctx.models.User.countDocuments({}), 0);
  assert.equal(await ctx.models.AppSettings.countDocuments({}), 0, 'no marker left behind');
});

test('creates the owner admin once, then refuses every later run', async () => {
  const result = await runBootstrap({ email: 'Owner@Example.test', confirmEmail: 'owner@example.test', password: ADMIN_PASSWORD, name: 'Owner' });
  assert.equal(result.mode, 'created');
  const owner = await ctx.models.User.findOne({ email: 'owner@example.test' }).lean();
  assert.equal(owner.role, 'admin');

  const login = await request(ctx.app).post('/api/auth/login').send({ email: 'owner@example.test', password: ADMIN_PASSWORD });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.role, 'admin');

  await assert.rejects(
    () => runBootstrap({ email: 'second@example.test', confirmEmail: 'second@example.test', password: ADMIN_PASSWORD }),
    /already exists|only run once/,
  );
  // Even with no admin left, the one-time marker still blocks a second run.
  await ctx.models.User.updateMany({}, { role: 'user' });
  await assert.rejects(
    () => runBootstrap({ email: 'third@example.test', confirmEmail: 'third@example.test', password: ADMIN_PASSWORD }),
    /only run once/,
  );
  const audit = await ctx.models.AuditLog.findOne({ action: 'system.owner_admin_created' }).lean();
  assert.ok(audit);
  assert.equal(audit.actorEmail, 'system:bootstrap');
});

test('promoting a pre-existing account replaces its password and signs out its sessions', async () => {
  const squatter = await signupAgent(ctx.app, { name: 'Early Signup', email: 'owner@example.test' });
  assert.equal(squatter.user.role, 'user', 'a public sign-up is never an admin');

  const result = await runBootstrap({ email: 'owner@example.test', confirmEmail: 'owner@example.test', password: ADMIN_PASSWORD });
  assert.equal(result.mode, 'promoted');

  assert.equal((await squatter.agent.get('/api/auth/me')).status, 401, 'old sessions revoked');
  const oldPassword = await request(ctx.app).post('/api/auth/login').send({ email: 'owner@example.test', password: STRONG_PASSWORD });
  assert.equal(oldPassword.status, 401, 'old password no longer works');
  const newPassword = await request(ctx.app).post('/api/auth/login').send({ email: 'owner@example.test', password: ADMIN_PASSWORD });
  assert.equal(newPassword.status, 200);
  assert.equal(newPassword.body.user.role, 'admin');
});

test('--keep-password promotes an existing account without touching its password', async () => {
  const owner = await signupAgent(ctx.app, { name: 'Owner', email: 'owner@example.test' });
  const result = await runBootstrap({ email: 'owner@example.test', confirmEmail: 'owner@example.test', keepExistingPassword: true });
  assert.equal(result.mode, 'promoted_kept_password');
  assert.equal((await owner.agent.get('/api/auth/me')).status, 401, 'old sessions still revoked');
  const login = await request(ctx.app).post('/api/auth/login').send({ email: 'owner@example.test', password: STRONG_PASSWORD });
  assert.equal(login.status, 200, 'existing password still works');
  assert.equal(login.body.user.role, 'admin');
});

test('--keep-password refuses when the account does not exist yet', async () => {
  await assert.rejects(
    () => runBootstrap({ email: 'nobody@example.test', confirmEmail: 'nobody@example.test', keepExistingPassword: true }),
    /already exists/,
  );
  assert.equal(await ctx.models.User.countDocuments({}), 0);
  assert.equal(await ctx.models.AppSettings.countDocuments({}), 0);
});

test('refuses when an administrator already exists without a marker', async () => {
  const { email } = await signupAgent(ctx.app, { email: 'existing.admin@example.test' });
  await ctx.models.User.updateOne({ email }, { role: 'admin' });
  await assert.rejects(
    () => runBootstrap({ email: 'new@example.test', confirmEmail: 'new@example.test', password: ADMIN_PASSWORD }),
    /already exists/,
  );
  assert.equal(await ctx.models.AppSettings.countDocuments({ key: 'owner_bootstrap' }), 0);
});
