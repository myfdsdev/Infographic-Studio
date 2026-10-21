// Cross-account isolation: one user can never see or change another user's data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestEnvironment, signupAgent, loginAgent } from '../fixtures/testEnvironment.js';

let ctx;
let alice;
let bob;
before(async () => {
  ctx = await startTestEnvironment();
  alice = await signupAgent(ctx.app, { name: 'Alice' });
  bob = await signupAgent(ctx.app, { name: 'Bob' });
});
after(async () => {
  await ctx?.stop();
});

test('each user only ever sees their own identity', async () => {
  const a = await alice.agent.get('/api/auth/me');
  const b = await bob.agent.get('/api/auth/me');
  assert.equal(a.body.user.email, alice.email);
  assert.equal(b.body.user.email, bob.email);
});

test('session lists are owner-scoped', async () => {
  await loginAgent(ctx.app, { email: alice.email }); // a second session for Alice
  const aliceSessions = (await alice.agent.get('/api/settings/sessions')).body.items;
  const bobSessions = (await bob.agent.get('/api/settings/sessions')).body.items;
  assert.equal(aliceSessions.length, 2);
  assert.equal(bobSessions.length, 1);
  const aliceIds = new Set(aliceSessions.map((s) => s.id));
  assert.ok(bobSessions.every((s) => !aliceIds.has(s.id)));
  assert.equal(aliceSessions.filter((s) => s.current).length, 1);
});

test("revoking another user's session id is a 404 and has no effect", async () => {
  const aliceSessions = (await alice.agent.get('/api/settings/sessions')).body.items;
  const target = aliceSessions[0].id;
  const res = await bob.agent.delete(`/api/settings/sessions/${target}`);
  assert.equal(res.status, 404);
  assert.equal((await alice.agent.get('/api/auth/me')).status, 200);
  const stillThere = await ctx.models.Session.findById(target).lean();
  assert.equal(stillThere.revokedAt, null);
});

test("'sign out other sessions' only touches the caller's own sessions", async () => {
  const before = await ctx.models.Session.countDocuments({ userId: alice.user.id, revokedAt: null });
  assert.ok(before >= 2);
  const res = await bob.agent.post('/api/settings/sessions/revoke-others');
  assert.equal(res.status, 200);
  assert.equal(res.body.revoked, 0);
  const after = await ctx.models.Session.countDocuments({ userId: alice.user.id, revokedAt: null });
  assert.equal(after, before);
  assert.equal((await alice.agent.get('/api/auth/me')).status, 200);
});

test("profile updates never affect another account", async () => {
  await bob.agent.patch('/api/settings/account').send({ name: 'Bob Renamed' });
  const aliceNow = await ctx.models.User.findById(alice.user.id).lean();
  assert.equal(aliceNow.name, 'Alice');
});

test('a regular user cannot read another account through admin endpoints', async () => {
  const res = await bob.agent.get(`/api/admin/users/${alice.user.id}`);
  assert.equal(res.status, 403);
});

test('malformed session ids are rejected', async () => {
  const res = await bob.agent.delete('/api/settings/sessions/not-an-id');
  assert.equal(res.status, 400);
});

test('a user can revoke one of their own sessions', async () => {
  const second = await loginAgent(ctx.app, { email: bob.email });
  const items = (await bob.agent.get('/api/settings/sessions')).body.items;
  const other = items.find((s) => !s.current);
  const res = await bob.agent.delete(`/api/settings/sessions/${other.id}`);
  assert.equal(res.status, 200);
  assert.equal((await second.agent.get('/api/auth/me')).status, 401);
  assert.equal((await bob.agent.get('/api/auth/me')).status, 200);
});
