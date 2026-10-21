// Infographics through the dashboard API against a mock Kie.ai: validation,
// strict BYOK, the prompt and payload sent to Nano Banana 2, saving the
// finished image privately, download, regenerate, history, failures and
// ownership. The mock returns placeholder images, never real generations.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { startMockKie } from '../fixtures/mockKie.js';
import { startTestEnvironment, signupAgent, settleInfographic, getBytes } from '../fixtures/testEnvironment.js';

const KEY = 'kie_test_key_INFO_0123456789abcdef';
const BODY = { topic: 'Create an infographic explaining 5 benefits of AI automation for small businesses.', style: 'minimal', aspectRatio: '1:1' };

let mock;
let ctx;
let worker;
before(async () => {
  mock = await startMockKie();
  ctx = await startTestEnvironment({ KIE_API_BASE_URL: mock.url, JOB_USER_CONCURRENCY: '4' });
  const { createWorker } = await import('../../src/jobs/worker.js');
  const { logger } = await import('../../src/config/logger.js');
  worker = createWorker({ env: ctx.env, logger, workerId: 'infographic-worker' });
});
after(async () => {
  await ctx?.stop();
  await mock?.stop();
});
beforeEach(() => {
  mock.state.validKeys = new Set([KEY]);
  mock.state.createQueue = [];
  mock.state.createMode = 'ok';
  mock.state.fileMode = 'ok';
  mock.state.failMessage = null;
  mock.state.sequence = ['waiting', 'generating', 'success'];
});

async function userWithKey() {
  const account = await signupAgent(ctx.app);
  const saved = await account.agent.put('/api/settings/credentials/kie').send({ apiKey: KEY });
  assert.equal(saved.status, 200);
  return account;
}

test('options list the three styles and three aspect ratios', async () => {
  const { agent } = await signupAgent(ctx.app);
  const res = await agent.get('/api/infographics/options');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.styles.map((s) => s.id), ['minimal', 'corporate', 'colorful']);
  assert.deepEqual(res.body.aspectRatios.map((r) => r.id), ['1:1', '3:4', '9:16']);
  assert.equal(res.body.model.id, 'z-image');
  assert.equal((await request(ctx.app).get('/api/infographics/options')).status, 401);
});

test('an infographic is generated with the user\'s key, saved privately and downloadable', async () => {
  const { agent } = await userWithKey();
  const created = await agent.post('/api/infographics').send(BODY);
  assert.equal(created.status, 202, JSON.stringify(created.body));
  const id = created.body.infographic.id;
  assert.equal(created.body.infographic.status, 'queued');
  assert.equal(created.body.infographic.image, null);

  const settled = await settleInfographic(worker, ctx.models, id);
  assert.equal(settled.status, 'completed');

  const task = [...mock.state.tasks.values()].at(-1);
  assert.equal(task.apiKey, KEY);
  assert.equal(task.model, 'z-image');
  assert.deepEqual(Object.keys(task.input).sort(), ['aspect_ratio', 'nsfw_checker', 'prompt']);
  assert.equal(task.input.aspect_ratio, '1:1');
  assert.ok(task.input.prompt.length <= 1000);
  assert.ok(task.input.prompt.includes(BODY.topic));
  assert.match(task.input.prompt, /never invent numbers/);
  assert.match(task.input.prompt, /minimal/i);

  const view = await agent.get(`/api/infographics/${id}`);
  assert.equal(view.status, 200);
  const item = view.body.infographic;
  assert.equal(item.status, 'completed');
  assert.equal(item.image.url, `/api/infographics/${id}/image`);
  assert.equal(item.image.width, 384);
  assert.ok(!JSON.stringify(view.body).includes(KEY));
  assert.ok(!JSON.stringify(view.body).includes(mock.url), 'no provider URLs reach the client');

  const bytes = await getBytes(agent, item.image.url);
  assert.equal(bytes.status, 200);
  assert.equal(bytes.headers['content-type'], 'image/png');
  assert.ok(Buffer.compare(bytes.body.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) === 0);
  const download = await agent.get(`${item.image.url}?download=1`);
  assert.match(download.headers['content-disposition'], /^attachment; filename="create-an-infographic-explaining-5-benefits-of-ai.*\.png"$/);
});

test('validation rejects short topics, unknown styles and unsupported ratios before any provider call', async () => {
  const { agent } = await userWithKey();
  const before = mock.state.calls.create;
  for (const body of [
    { ...BODY, topic: 'AI' },
    { ...BODY, topic: 'x'.repeat(401) },
    { ...BODY, aspectRatio: '4:5' },
    { ...BODY, style: 'neon' },
    { ...BODY, aspectRatio: '16:9' },
    { ...BODY, aspectRatio: '4:3' },
    { ...BODY, model: 'grok-imagine/image-to-video' },
    { ...BODY, apiKey: 'smuggled-key-0123456789' },
  ]) {
    const res = await agent.post('/api/infographics').send(body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.equal(mock.state.calls.create, before);
});

test('strict BYOK: no key or a rejected key blocks generation; keys are never shared', async () => {
  const noKey = await signupAgent(ctx.app);
  const missing = await noKey.agent.post('/api/infographics').send(BODY);
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error.code, 'NO_API_KEY');

  const rejected = await userWithKey();
  await ctx.models.ApiCredential.updateOne({ userId: rejected.user.id }, { $set: { status: 'invalid' } });
  const invalid = await rejected.agent.post('/api/infographics').send(BODY);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, 'API_KEY_INVALID');

  // Removing the key blocks the next generation again.
  const owner = await userWithKey();
  assert.equal((await owner.agent.delete('/api/settings/credentials/kie')).status, 200);
  assert.equal((await owner.agent.post('/api/infographics').send(BODY)).body.error.code, 'NO_API_KEY');

  assert.equal(await ctx.models.Infographic.countDocuments({ userId: { $in: [noKey.user.id, rejected.user.id, owner.user.id] } }), 0);
});

test('a provider failure marks the infographic failed with the provider\'s reason', async () => {
  const { agent } = await userWithKey();
  mock.state.sequence = ['waiting', 'fail'];
  mock.state.failMessage = 'Content policy violation';
  const created = await agent.post('/api/infographics').send({ ...BODY, style: 'colorful', aspectRatio: '9:16' });
  const settled = await settleInfographic(worker, ctx.models, created.body.infographic.id);
  assert.equal(settled.status, 'failed');
  const view = (await agent.get(`/api/infographics/${settled._id}`)).body.infographic;
  assert.equal(view.status, 'failed');
  assert.ok(view.error.code);
  assert.match(view.error.message, /Content policy violation/);
  assert.equal(view.image, null);
  assert.equal((await agent.get(`/api/infographics/${settled._id}/image`)).status, 404);
});

test('a rejected key at the provider fails the job and marks the key invalid', async () => {
  const { agent, user } = await userWithKey();
  mock.state.createMode = 'unauthorized';
  const created = await agent.post('/api/infographics').send(BODY);
  const settled = await settleInfographic(worker, ctx.models, created.body.infographic.id);
  assert.equal(settled.status, 'failed');
  assert.equal(settled.error.code, 'PROVIDER_KEY_REJECTED');
  const credential = await ctx.models.ApiCredential.findOne({ userId: user.id }).lean();
  assert.equal(credential.status, 'invalid');
});

test('an unreadable result is retried and finally reported, never stored as an image', async () => {
  const { agent } = await userWithKey();
  mock.state.fileMode = 'not_image';
  const created = await agent.post('/api/infographics').send(BODY);
  const id = created.body.infographic.id;
  let item;
  for (let round = 0; round < 5; round += 1) {
    item = await settleInfographic(worker, ctx.models, id, { maxRounds: 50 });
    if (item.status !== 'queued' && item.status !== 'processing') break;
    // Let the save claim run out between attempts.
    await ctx.models.Infographic.updateOne({ _id: id }, { $set: { 'saving.claimedUntil': new Date(0) } });
  }
  assert.equal(item.status, 'failed');
  assert.equal(item.saving.attempts, 3);
  assert.equal(await ctx.models.Asset.countDocuments({ userId: item.userId }), 0);
});

test('regenerate makes a new infographic with the same settings; history is newest first', async () => {
  const { agent } = await userWithKey();
  const first = await agent.post('/api/infographics').send({ ...BODY, style: 'corporate', aspectRatio: '3:4' });
  await settleInfographic(worker, ctx.models, first.body.infographic.id);
  const again = await agent.post(`/api/infographics/${first.body.infographic.id}/regenerate`).send({});
  assert.equal(again.status, 202);
  const second = again.body.infographic;
  assert.notEqual(second.id, first.body.infographic.id);
  assert.equal(second.style, 'corporate');
  assert.equal(second.aspectRatio, '3:4');
  assert.equal(second.regeneratedFrom, first.body.infographic.id);
  await settleInfographic(worker, ctx.models, second.id);

  const list = await agent.get('/api/infographics?limit=1');
  assert.equal(list.status, 200);
  assert.equal(list.body.total, 2);
  assert.equal(list.body.pages, 2);
  assert.equal(list.body.items[0].id, second.id);
  const completed = await agent.get('/api/infographics?status=completed');
  assert.equal(completed.body.total, 2);
});

test('the same Idempotency-Key returns the same infographic and generates once', async () => {
  const { agent, user } = await userWithKey();
  const before = mock.state.calls.create;
  const a = await agent.post('/api/infographics').set('Idempotency-Key', 'click-info-0001').send(BODY);
  const b = await agent.post('/api/infographics').set('Idempotency-Key', 'click-info-0001').send(BODY);
  assert.equal(b.status, 200);
  assert.equal(b.body.deduplicated, true);
  assert.equal(b.body.infographic.id, a.body.infographic.id);
  await settleInfographic(worker, ctx.models, a.body.infographic.id);
  assert.equal(mock.state.calls.create - before, 1);
  assert.equal(await ctx.models.Infographic.countDocuments({ userId: user.id }), 1);
});

test('users can only read, download, regenerate or delete their own infographics', async () => {
  const alice = await userWithKey();
  const bob = await userWithKey();
  const created = await alice.agent.post('/api/infographics').send(BODY);
  const id = created.body.infographic.id;
  await settleInfographic(worker, ctx.models, id);

  assert.equal((await bob.agent.get(`/api/infographics/${id}`)).status, 404);
  assert.equal((await bob.agent.get(`/api/infographics/${id}/image`)).status, 404);
  assert.equal((await bob.agent.post(`/api/infographics/${id}/regenerate`).send({})).status, 404);
  assert.equal((await bob.agent.delete(`/api/infographics/${id}`)).status, 404);
  assert.equal((await bob.agent.get('/api/infographics')).body.total, 0);
  assert.equal((await request(ctx.app).get(`/api/infographics/${id}`)).status, 401);
  assert.equal((await bob.agent.get('/api/infographics/not-an-id')).status, 400);

  const item = await ctx.models.Infographic.findById(id).lean();
  const asset = await ctx.models.Asset.findById(item.image.assetId).lean();
  assert.equal((await bob.agent.get(`/api/assets/${asset._id}/content`)).status, 404);

  assert.equal((await alice.agent.delete(`/api/infographics/${id}`)).status, 200);
  assert.equal(await ctx.models.Infographic.countDocuments({ _id: id }), 0);
  assert.equal(await ctx.models.Asset.countDocuments({ _id: asset._id }), 0);
});

test('an active infographic cannot be deleted', async () => {
  const { agent } = await userWithKey();
  const created = await agent.post('/api/infographics').send(BODY);
  const res = await agent.delete(`/api/infographics/${created.body.infographic.id}`);
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'INFOGRAPHIC_ACTIVE');
  await settleInfographic(worker, ctx.models, created.body.infographic.id);
});

test('deleting the account removes its infographics and stored images', async () => {
  const { agent, user, password } = await userWithKey();
  const created = await agent.post('/api/infographics').send(BODY);
  await settleInfographic(worker, ctx.models, created.body.infographic.id);
  assert.equal(await ctx.models.Asset.countDocuments({ userId: user.id }), 1);
  const res = await agent.post('/api/settings/account/delete').send({ password });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(await ctx.models.Infographic.countDocuments({ userId: user.id }), 0);
  assert.equal(await ctx.models.Asset.countDocuments({ userId: user.id }), 0);
});
