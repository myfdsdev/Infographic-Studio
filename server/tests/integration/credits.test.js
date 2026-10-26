// Platform credits and bonus sign-up links against a mock Kie.ai: the
// administrator's platform key (never shown in full), credits spent before
// the user's own key, atomic spending and refunds, bonus links with limits,
// expiry and an on/off switch, and admin credit adjustments.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { startMockKie } from '../fixtures/mockKie.js';
import { startTestEnvironment, signupAgent, createAdminAgent, settleInfographic, uniqueEmail, STRONG_PASSWORD } from '../fixtures/testEnvironment.js';

const PLATFORM_KEY = 'kie_platform_key_PLAT_0123456789abcdef';
const USER_KEY = 'kie_user_key_USER_0123456789abcdef';
const BODY = { topic: 'Five simple habits that help remote teams communicate better.', style: 'minimal', aspectRatio: '1:1' };

let mock;
let ctx;
let worker;
let admin;
before(async () => {
  mock = await startMockKie();
  ctx = await startTestEnvironment({ KIE_API_BASE_URL: mock.url, JOB_USER_CONCURRENCY: '4' });
  const { createWorker } = await import('../../src/jobs/worker.js');
  const { logger } = await import('../../src/config/logger.js');
  worker = createWorker({ env: ctx.env, logger, workerId: 'credits-worker' });
  admin = await createAdminAgent(ctx.app, ctx.models);
});
after(async () => {
  await ctx?.stop();
  await mock?.stop();
});
beforeEach(() => {
  mock.state.validKeys = new Set([PLATFORM_KEY, USER_KEY]);
  mock.state.createMode = 'ok';
  mock.state.fileMode = 'ok';
  mock.state.failMessage = null;
  mock.state.sequence = ['waiting', 'generating', 'success'];
});

async function savePlatformKey() {
  const res = await admin.agent.put('/api/admin/platform-key').send({ apiKey: PLATFORM_KEY });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

async function newBonusLink(body) {
  const res = await admin.agent.post('/api/admin/bonus-links').send({ name: 'Launch promo', credits: 30, ...body });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.link;
}

async function signupWithBonus(code) {
  const agent = request.agent(ctx.app);
  const email = uniqueEmail('bonus');
  const res = await agent.post('/api/auth/signup').send({ name: 'Bonus User', email, password: STRONG_PASSWORD, bonusCode: code });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { agent, email, body: res.body };
}

async function creditsOf(agent) {
  return (await agent.get('/api/settings/credits')).body;
}

test('the platform key is admin-only, verified, and never returned in full', async () => {
  const member = await signupAgent(ctx.app);
  assert.equal((await member.agent.put('/api/admin/platform-key').send({ apiKey: PLATFORM_KEY })).status, 403);

  const rejected = await admin.agent.put('/api/admin/platform-key').send({ apiKey: 'kie_wrong_key_0000000000000000' });
  assert.equal(rejected.body.error.code, 'KEY_REJECTED');

  const saved = await savePlatformKey();
  assert.equal(saved.key.configured, true);
  assert.equal(saved.key.status, 'valid');
  assert.equal(saved.key.last4, PLATFORM_KEY.slice(-4));
  const status = await admin.agent.get('/api/admin/platform-key');
  assert.ok(!JSON.stringify(status.body).includes(PLATFORM_KEY));
  const stored = await ctx.models.AppSettings.findOne({ key: 'platform_provider_key' }).lean();
  assert.ok(!JSON.stringify(stored).includes(PLATFORM_KEY), 'stored encrypted');
});

test('a bonus link gives new accounts credits once; limits, expiry and the switch are enforced', async () => {
  await savePlatformKey();
  const link = await newBonusLink({ maxUses: 2 });
  assert.match(link.url, /\/signup\?bonus=/);
  assert.deepEqual((await request(ctx.app).get(`/api/auth/bonus/${link.code}`)).body, { valid: true, credits: 30 });

  const first = await signupWithBonus(link.code);
  assert.equal(first.body.bonus.credits, 30);
  assert.equal(first.body.user.credits, 30);
  assert.equal((await creditsOf(first.agent)).credits, 30);
  await signupWithBonus(link.code);

  // Used up: a third sign-up still works but gets nothing.
  assert.equal((await request(ctx.app).get(`/api/auth/bonus/${link.code}`)).body.reason, 'used_up');
  const third = await signupWithBonus(link.code);
  assert.equal(third.body.bonus, null);
  assert.equal(third.body.user.credits, 0);

  const detail = await admin.agent.get(`/api/admin/bonus-links/${link.id}`);
  assert.equal(detail.body.link.uses, 2);
  assert.equal(detail.body.link.creditsGranted, 60);
  assert.equal(detail.body.link.state, 'used_up');
  assert.equal(detail.body.signups.length, 2);

  // Switched off.
  const other = await newBonusLink({});
  await admin.agent.patch(`/api/admin/bonus-links/${other.id}`).send({ enabled: false });
  assert.equal((await signupWithBonus(other.code)).body.user.credits, 0);
  await admin.agent.patch(`/api/admin/bonus-links/${other.id}`).send({ enabled: true });
  assert.equal((await signupWithBonus(other.code)).body.user.credits, 30);

  // Expired, and unknown codes.
  const expiring = await newBonusLink({});
  await ctx.models.BonusLink.updateOne({ _id: expiring.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await signupWithBonus(expiring.code)).body.user.credits, 0);
  assert.equal((await signupWithBonus('no-such-code-123')).body.user.credits, 0);

  // Ordinary users cannot manage links.
  const member = await signupAgent(ctx.app);
  assert.equal((await member.agent.get('/api/admin/bonus-links')).status, 403);
});

test('credits pay first on the platform key, then the own key takes over', async () => {
  await savePlatformKey();
  const link = await newBonusLink({ credits: 25 });
  const { agent } = await signupWithBonus(link.code);

  const before = await creditsOf(agent);
  assert.equal(before.creditsPerInfographic, 10);
  assert.equal(before.nextSource, 'credits');

  const one = await agent.post('/api/infographics').send(BODY);
  assert.equal(one.status, 202, JSON.stringify(one.body));
  assert.equal(one.body.infographic.billing.paidWith, 'credits');
  const job = await ctx.models.GenerationJob.findById(one.body.infographic.jobId).lean();
  assert.equal(job.keySource, 'platform');
  await settleInfographic(worker, ctx.models, one.body.infographic.id);
  assert.equal([...mock.state.tasks.values()].at(-1).apiKey, PLATFORM_KEY);

  await agent.post('/api/infographics').send({ ...BODY, style: 'dark' });
  assert.equal((await creditsOf(agent)).credits, 5);

  // 5 left, 10 needed, no own key: refused before anything starts.
  const refused = await agent.post('/api/infographics').send({ ...BODY, style: 'retro' });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error.code, 'NO_CREDITS');

  // With an own key the next one runs on it and costs no credits.
  assert.equal((await agent.put('/api/settings/credentials/kie').send({ apiKey: USER_KEY })).status, 200);
  assert.equal((await creditsOf(agent)).nextSource, 'own_key');
  const own = await agent.post('/api/infographics').send({ ...BODY, style: 'retro' });
  assert.equal(own.body.infographic.billing.paidWith, 'own_key');
  await settleInfographic(worker, ctx.models, own.body.infographic.id);
  assert.equal([...mock.state.tasks.values()].at(-1).apiKey, USER_KEY);
  const after = await creditsOf(agent);
  assert.equal(after.credits, 5);
  assert.deepEqual(
    after.transactions.map((t) => [t.reason, t.amount]),
    [
      ['generation', -10],
      ['generation', -10],
      ['bonus_signup', 25],
    ],
  );
});

test('a failed credit-paid generation is refunded exactly once', async () => {
  await savePlatformKey();
  const link = await newBonusLink({ credits: 10 });
  const { agent } = await signupWithBonus(link.code);
  mock.state.sequence = ['waiting', 'fail'];
  const started = await agent.post('/api/infographics').send(BODY);
  assert.equal((await creditsOf(agent)).credits, 0);
  const settled = await settleInfographic(worker, ctx.models, started.body.infographic.id);
  assert.equal(settled.status, 'failed');
  await worker.drainInfographics();
  const after = await creditsOf(agent);
  assert.equal(after.credits, 10);
  assert.equal(after.transactions.filter((t) => t.reason === 'refund').length, 1);
  assert.equal((await agent.get(`/api/infographics/${started.body.infographic.id}`)).body.infographic.billing.refunded, true);
});

test('a double click with the same Idempotency-Key is charged once', async () => {
  await savePlatformKey();
  const link = await newBonusLink({ credits: 10 });
  const { agent } = await signupWithBonus(link.code);
  const a = await agent.post('/api/infographics').set('Idempotency-Key', 'credit-click-0001').send(BODY);
  const b = await agent.post('/api/infographics').set('Idempotency-Key', 'credit-click-0001').send(BODY);
  assert.equal(a.status, 202);
  assert.equal(b.status, 200);
  assert.equal(b.body.infographic.id, a.body.infographic.id);
  assert.equal((await creditsOf(agent)).credits, 0);
});

test('admins set the price and adjust credits; balances never go below zero', async () => {
  await savePlatformKey();
  const member = await signupAgent(ctx.app);
  const { id } = member.user;
  const added = await admin.agent.post(`/api/admin/users/${id}/credits`).send({ amount: 40, note: 'Support gift' });
  assert.deepEqual(added.body, { credits: 40 });
  const tooMuch = await admin.agent.post(`/api/admin/users/${id}/credits`).send({ amount: -100 });
  assert.equal(tooMuch.body.error.code, 'NOT_ENOUGH_CREDITS');
  assert.deepEqual((await admin.agent.post(`/api/admin/users/${id}/credits`).send({ amount: -15 })).body, { credits: 25 });
  assert.equal((await member.agent.post(`/api/admin/users/${id}/credits`).send({ amount: 1000 })).status, 403);

  await admin.agent.patch('/api/admin/settings').send({ credits: { perInfographic: 25 } });
  const started = await member.agent.post('/api/infographics').send(BODY);
  assert.equal(started.body.infographic.billing.credits, 25);
  assert.equal((await creditsOf(member.agent)).credits, 0);
  await admin.agent.patch('/api/admin/settings').send({ credits: { perInfographic: 10 } });
});

test('without a platform key nothing changes: strict own-key generation', async () => {
  await admin.agent.delete('/api/admin/platform-key');
  const member = await signupAgent(ctx.app);
  await admin.agent.post(`/api/admin/users/${member.user.id}/credits`).send({ amount: 50 });
  const refused = await member.agent.post('/api/infographics').send(BODY);
  assert.equal(refused.body.error.code, 'NO_API_KEY');
  assert.equal((await creditsOf(member.agent)).nextSource, null);
  assert.equal((await creditsOf(member.agent)).credits, 50, 'nothing was spent');
});
