// Users' provider API keys: add, test, mask, replace, delete, and never leak.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import pino from 'pino';
import request from 'supertest';
import { startMockKie } from '../fixtures/mockKie.js';
import { startTestEnvironment, signupAgent, createAdminAgent } from '../fixtures/testEnvironment.js';

const KEY_A = 'kie_test_key_AAAA_0123456789abWXYZ';
const KEY_A2 = 'kie_test_key_ZZZZ_fedcba9876543210';
const KEY_B = 'kie_test_key_BBBB_0123456789abcdef';

let mock;
let ctx;
before(async () => {
  mock = await startMockKie();
  ctx = await startTestEnvironment({ KIE_API_BASE_URL: mock.url });
});
after(async () => {
  await ctx?.stop();
  await mock?.stop();
});
beforeEach(() => {
  mock.reset();
  mock.state.validKeys = new Set([KEY_A, KEY_A2, KEY_B]);
});

const save = (agent, apiKey) => agent.put('/api/settings/credentials/kie').send({ apiKey });

test('saving a valid key verifies it without generating, stores it encrypted, and returns only the last 4', async () => {
  const { agent, user } = await signupAgent(ctx.app);
  const res = await save(agent, KEY_A);
  assert.equal(res.status, 200);
  assert.equal(res.body.credential.last4, 'WXYZ');
  assert.equal(res.body.credential.status, 'valid');
  assert.equal(res.body.credential.balance, 100);
  assert.equal(res.body.verification.ok, true);
  assert.equal(mock.state.calls.credit, 1, 'tested with the credit endpoint');
  assert.equal(mock.state.calls.create, 0, 'no generation was started');
  assert.ok(!JSON.stringify(res.body).includes(KEY_A));
  assert.ok(!('encryptedKey' in res.body.credential));

  const stored = await ctx.models.ApiCredential.findOne({ userId: user.id }).select('+encryptedKey').lean();
  assert.match(stored.encryptedKey, /^v1\./);
  assert.ok(!stored.encryptedKey.includes(KEY_A));
  assert.ok(!JSON.stringify(stored).includes(KEY_A));

  const list = await agent.get('/api/settings/credentials');
  assert.equal(list.body.items.length, 1);
  assert.ok(!JSON.stringify(list.body).includes(KEY_A));
});

test('a key the provider rejects is not saved', async () => {
  const { agent, user } = await signupAgent(ctx.app);
  const res = await save(agent, 'kie_wrong_key_0123456789abcdef');
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'KEY_REJECTED');
  assert.equal(await ctx.models.ApiCredential.countDocuments({ userId: user.id }), 0);
});

test('malformed keys are refused before contacting the provider', async () => {
  const { agent } = await signupAgent(ctx.app);
  for (const bad of ['short', 'has spaces in the middle of it', 'x'.repeat(250)]) {
    const res = await save(agent, bad);
    assert.equal(res.status, 400, bad);
  }
  assert.equal(mock.state.calls.credit, 0);
});

test('if the provider is down the key is saved as unverified and can be tested later', async () => {
  const { agent } = await signupAgent(ctx.app);
  mock.state.creditMode = 'maintenance';
  const saved = await save(agent, KEY_A);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.credential.status, 'unverified');
  assert.match(saved.body.credential.lastCheckError, /maintenance/i);

  mock.state.creditMode = 'ok';
  mock.state.credits = 42.5;
  const tested = await agent.post('/api/settings/credentials/kie/verify');
  assert.equal(tested.status, 200);
  assert.equal(tested.body.credential.status, 'valid');
  assert.equal(tested.body.credential.balance, 42.5);
});

test('a key revoked at the provider is marked invalid by the test', async () => {
  const { agent } = await signupAgent(ctx.app);
  await save(agent, KEY_A);
  mock.state.validKeys.delete(KEY_A);
  const tested = await agent.post('/api/settings/credentials/kie/verify');
  assert.equal(tested.status, 200);
  assert.equal(tested.body.verification.ok, false);
  assert.equal(tested.body.credential.status, 'invalid');
});

test('replacing and deleting a key', async () => {
  const { agent, user } = await signupAgent(ctx.app);
  await save(agent, KEY_A);
  const replaced = await save(agent, KEY_A2);
  assert.equal(replaced.body.credential.last4, '3210');
  assert.equal(await ctx.models.ApiCredential.countDocuments({ userId: user.id }), 1);

  const removed = await agent.delete('/api/settings/credentials/kie');
  assert.equal(removed.status, 200);
  assert.deepEqual((await agent.get('/api/settings/credentials')).body.items, []);
  assert.equal((await agent.delete('/api/settings/credentials/kie')).status, 404);

  const actions = (await ctx.models.AuditLog.find({ actorId: user.id, area: 'account' }).lean()).map((e) => e.action);
  assert.ok(actions.includes('credentials.added'));
  assert.ok(actions.includes('credentials.replaced'));
  assert.ok(actions.includes('credentials.deleted'));
  const audit = JSON.stringify(await ctx.models.AuditLog.find({}).lean());
  assert.ok(!audit.includes(KEY_A) && !audit.includes(KEY_A2), 'keys never reach the audit log');
});

test("keys are owner-scoped: one user never sees or uses another user's key", async () => {
  const alice = await signupAgent(ctx.app);
  const bob = await signupAgent(ctx.app);
  await save(alice.agent, KEY_A);
  assert.deepEqual((await bob.agent.get('/api/settings/credentials')).body.items, []);
  assert.equal((await bob.agent.post('/api/settings/credentials/kie/verify')).status, 404);
  assert.equal((await bob.agent.delete('/api/settings/credentials/kie')).status, 404);
  assert.equal((await alice.agent.get('/api/settings/credentials')).body.items.length, 1);
});

test("a ciphertext copied onto another user's record cannot be used", async () => {
  const alice = await signupAgent(ctx.app);
  const bob = await signupAgent(ctx.app);
  await save(alice.agent, KEY_A);
  await save(bob.agent, KEY_B);
  const aliceRow = await ctx.models.ApiCredential.findOne({ userId: alice.user.id }).select('+encryptedKey').lean();
  await ctx.models.ApiCredential.updateOne({ userId: bob.user.id }, { encryptedKey: aliceRow.encryptedKey });
  const res = await bob.agent.post('/api/settings/credentials/kie/verify');
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'KEY_UNREADABLE');
});

test('administrators see provider and status only, never the key or its digits', async () => {
  const owner = await signupAgent(ctx.app);
  await save(owner.agent, KEY_A);
  const admin = await createAdminAgent(ctx.app, ctx.models);
  const res = await admin.agent.get(`/api/admin/users/${owner.user.id}`);
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body.credentials[0]).sort(), ['lastVerifiedAt', 'provider', 'status', 'updatedAt']);
  const serialized = JSON.stringify(res.body);
  assert.ok(!serialized.includes(KEY_A));
  assert.ok(!serialized.includes('WXYZ'));
  assert.ok(!serialized.includes('last4'));
  assert.ok(!serialized.includes('encryptedKey'));
});

test('request logs never contain the key, even at trace level', async () => {
  const lines = [];
  const logger = pino({ level: 'trace' }, { write: (line) => lines.push(line) });
  const { createApp } = await import('../../src/app.js');
  const loudApp = createApp({ env: ctx.env, logger });
  const { email, password } = await signupAgent(ctx.app);
  const agent = request.agent(loudApp);
  await agent.post('/api/auth/login').send({ email, password });
  await agent.put('/api/settings/credentials/kie').send({ apiKey: KEY_A });
  await agent.post('/api/settings/credentials/kie/verify');
  await agent.put('/api/settings/credentials/kie').send({ apiKey: 'kie_wrong_key_0123456789abcdef' });
  const all = lines.join('\n');
  assert.ok(lines.length > 0);
  assert.ok(!all.includes(KEY_A));
  assert.ok(!all.includes('kie_wrong_key_0123456789abcdef'));
  assert.ok(!all.includes(password));
});

test('the provider receives the key only as a Bearer header', async () => {
  const { agent } = await signupAgent(ctx.app);
  await save(agent, KEY_A);
  assert.ok(mock.state.authHeaders.includes(`Bearer ${KEY_A}`));
});

test('the provider catalogue is available to signed-in users', async () => {
  const { agent } = await signupAgent(ctx.app);
  const res = await agent.get('/api/settings/providers');
  assert.equal(res.status, 200);
  const kie = res.body.items.find((p) => p.key === 'kie');
  const ids = kie.models.map((m) => m.id);
  assert.ok(ids.includes('nano-banana-2'));
  assert.ok(!ids.includes('grok-imagine/image-to-video'), 'video models are not offered');
  assert.ok(kie.models.every((m) => m.kind === 'image'));
  assert.equal((await request(ctx.app).get('/api/settings/providers')).status, 401);
});

test('deleting the account erases its encrypted key and job history', async () => {
  const { agent, user, password } = await signupAgent(ctx.app);
  await save(agent, KEY_A);
  await ctx.models.GenerationJob.create({
    userId: user.id,
    kind: 'image',
    provider: 'kie',
    model: 'nano-banana-2',
    request: { model: 'nano-banana-2', input: { prompt: 'private prompt' } },
    inputHash: 'a'.repeat(64),
    timeoutAt: new Date(Date.now() + 60000),
  });
  const res = await agent.post('/api/settings/account/delete').send({ password });
  assert.equal(res.status, 200);
  assert.equal(await ctx.models.ApiCredential.countDocuments({ userId: user.id }), 0);
  assert.equal(await ctx.models.GenerationJob.countDocuments({ userId: user.id }), 0);
});
