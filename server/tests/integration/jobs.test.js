// Durable generation jobs against a mock Kie.ai: states, provider ids, bounded
// retries, uncertain submissions, restart recovery, concurrency, duplicates.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startMockKie } from '../fixtures/mockKie.js';
import { startTestEnvironment, signupAgent, createAdminAgent, settleJob } from '../fixtures/testEnvironment.js';

const KEY = 'kie_test_key_JOBS_0123456789abcdef';

let mock;
let ctx;
let worker;
before(async () => {
  mock = await startMockKie();
  ctx = await startTestEnvironment({
    KIE_API_BASE_URL: mock.url,
    PROVIDER_SUBMIT_TIMEOUT_MS: '300',
    JOB_USER_CONCURRENCY: '1',
  });
  const { createWorker } = await import('../../src/jobs/worker.js');
  const { logger } = await import('../../src/config/logger.js');
  worker = createWorker({ env: ctx.env, logger, workerId: 'test-worker-a' });
});
after(async () => {
  await ctx?.stop();
  await mock?.stop();
});
beforeEach(async () => {
  // Test hygiene: a job left active by an earlier test must not consume this
  // test's scripted provider responses.
  await ctx.models.GenerationJob.updateMany(
    { status: { $in: ['queued', 'processing'] } },
    { $set: { status: 'cancelled', phase: 'done', lockedBy: null, lockedUntil: null } },
  );
  mock.reset();
  mock.state.validKeys = new Set([KEY]);
});

async function userWithKey() {
  const account = await signupAgent(ctx.app);
  const saved = await account.agent.put('/api/settings/credentials/kie').send({ apiKey: KEY });
  assert.equal(saved.status, 200);
  mock.state.calls.credit = 0;
  return account;
}

const IMAGE = { kind: 'image', model: 'nano-banana-2', prompt: 'Portrait of a friendly travel creator', aspectRatio: '9:16' };

test('a job goes queued -> processing -> completed and records the provider task id', async () => {
  const { agent } = await userWithKey();
  const created = await agent.post('/api/jobs').send(IMAGE);
  assert.equal(created.status, 202);
  assert.equal(created.body.job.status, 'queued');
  const done = await settleJob(worker, ctx.models, created.body.job.id);
  assert.equal(done.status, 'completed');
  assert.match(done.providerTaskId, /^task_mock_/);
  assert.deepEqual(done.result.urls, [`${mock.url}/files/${done.providerTaskId}.png`]);
  assert.equal(done.result.creditsConsumed, 4);
  assert.equal(mock.state.calls.create, 1);
  const sent = mock.state.tasks.get(done.providerTaskId);
  assert.deepEqual(sent.input, { prompt: IMAGE.prompt, aspect_ratio: '9:16', resolution: '1K', output_format: 'png' });

  const view = await agent.get(`/api/jobs/${done._id}`);
  assert.equal(view.body.job.status, 'completed');
  assert.ok(!JSON.stringify(view.body).includes(KEY));
  assert.ok(!JSON.stringify(view.body).includes('callbackTokenHash'));
  const types = view.body.job.events.map((e) => e.type);
  assert.ok(types.includes('submitting') && types.includes('submitted') && types.includes('completed'));
});

test('jobs need a saved key and valid model parameters', async () => {
  const noKey = await signupAgent(ctx.app);
  const missing = await noKey.agent.post('/api/jobs').send(IMAGE);
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error.code, 'NO_API_KEY');

  const { agent } = await userWithKey();
  const cases = [
    { ...IMAGE, model: 'grok-imagine/image-to-video' },
    { kind: 'video', model: 'kling-3.0/video', prompt: 'Walk' },
    { ...IMAGE, resolution: '8K' },
    { ...IMAGE, aspectRatio: '7:3' },
    { ...IMAGE, referenceImageUrls: ['http://insecure.example/a.png'] },
    { kind: 'image', model: 'google/nano-banana-edit', prompt: 'Restyle' },
    { kind: 'image', model: 'grok-imagine-image-2-0/text-to-image', prompt: 'A chart', aspectRatio: '4:5' },
    { ...IMAGE, characterId: 'a'.repeat(24) },
    { ...IMAGE, apiKey: 'smuggled' },
  ];
  for (const body of cases) {
    const res = await agent.post('/api/jobs').send(body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.equal(mock.state.calls.create, 0);
});

test('an invalid saved key blocks new jobs before anything is sent', async () => {
  const { agent, user } = await userWithKey();
  await ctx.models.ApiCredential.updateOne({ userId: user.id }, { $set: { status: 'invalid' } });
  const res = await agent.post('/api/jobs').send(IMAGE);
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'API_KEY_INVALID');
  assert.equal(mock.state.calls.create, 0);
});

test('the same Idempotency-Key returns the same job and submits once', async () => {
  const { agent } = await userWithKey();
  const first = await agent.post('/api/jobs').set('Idempotency-Key', 'click-0001-abcdef').send(IMAGE);
  const second = await agent.post('/api/jobs').set('Idempotency-Key', 'click-0001-abcdef').send({ ...IMAGE, prompt: 'different' });
  assert.equal(first.status, 202);
  assert.equal(second.status, 200);
  assert.equal(second.body.deduplicated, true);
  assert.equal(second.body.job.id, first.body.job.id);
  await settleJob(worker, ctx.models, first.body.job.id);
  assert.equal(mock.state.calls.create, 1);
});

test('an accidental double submit of the same request is collapsed', async () => {
  const { agent } = await userWithKey();
  const [a, b] = await Promise.all([agent.post('/api/jobs').send(IMAGE), agent.post('/api/jobs').send(IMAGE)]);
  const ids = new Set([a.body.job.id, b.body.job.id]);
  // A true race may create two rows; the second request after the first is stored must reuse it.
  const third = await agent.post('/api/jobs').send(IMAGE);
  assert.ok(ids.has(third.body.job.id));
  assert.equal(third.body.deduplicated, true);
});

test('rate limits are retried with backoff, and the retries are bounded', async () => {
  const { agent } = await userWithKey();
  mock.state.createQueue = ['rate_limited', 'rate_limited'];
  const ok = await agent.post('/api/jobs').send({ ...IMAGE, prompt: 'retry then succeed' });
  const done = await settleJob(worker, ctx.models, ok.body.job.id);
  assert.equal(done.status, 'completed');
  assert.equal(done.submitAttempts, 3);
  assert.equal(mock.state.calls.create, 3);

  mock.reset();
  mock.state.validKeys = new Set([KEY]);
  mock.state.createMode = 'rate_limited';
  const failing = await agent.post('/api/jobs').send({ ...IMAGE, prompt: 'always limited' });
  const failed = await settleJob(worker, ctx.models, failing.body.job.id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error.code, 'RATE_LIMITED');
  assert.equal(mock.state.calls.create, 3, 'never more than JOB_MAX_ATTEMPTS submissions');
});

test('a rejected key fails the job without retrying and marks the key invalid', async () => {
  const { agent, user } = await userWithKey();
  mock.state.createQueue = ['unauthorized'];
  const res = await agent.post('/api/jobs').send({ ...IMAGE, prompt: 'bad key' });
  const done = await settleJob(worker, ctx.models, res.body.job.id);
  assert.equal(done.status, 'failed');
  assert.equal(done.error.code, 'PROVIDER_KEY_REJECTED');
  assert.equal(mock.state.calls.create, 1);
  const credential = await ctx.models.ApiCredential.findOne({ userId: user.id }).lean();
  assert.equal(credential.status, 'invalid');
});

test('insufficient credits and invalid input fail immediately', async () => {
  const { agent } = await userWithKey();
  mock.state.createQueue = ['insufficient'];
  const poor = await settleJob(worker, ctx.models, (await agent.post('/api/jobs').send({ ...IMAGE, prompt: 'no credits' })).body.job.id);
  assert.equal(poor.error.code, 'INSUFFICIENT_CREDITS');
  mock.state.createQueue = ['invalid'];
  const invalid = await settleJob(worker, ctx.models, (await agent.post('/api/jobs').send({ ...IMAGE, prompt: 'bad input' })).body.job.id);
  assert.equal(invalid.error.code, 'INVALID_REQUEST');
  assert.equal(mock.state.calls.create, 2);
});

test('an uncertain submission (timeout after sending) is NOT resent', async () => {
  const { agent } = await userWithKey();
  mock.state.createMode = 'hang';
  mock.state.hangMs = 900;
  const res = await agent.post('/api/jobs').send({ ...IMAGE, prompt: 'slow provider' });
  const done = await settleJob(worker, ctx.models, res.body.job.id);
  assert.equal(done.status, 'failed');
  assert.equal(done.error.code, 'SUBMISSION_UNCERTAIN');
  assert.equal(done.submissionUncertain, true);
  assert.equal(mock.state.calls.create, 1, 'sent exactly once');
  assert.equal(mock.state.tasks.size, 1, 'the provider did create the task, which is why resending would double-charge');
});

test('a gateway error or a reply without a task id is also treated as uncertain', async () => {
  const { agent } = await userWithKey();
  mock.state.createQueue = ['html_502'];
  const gateway = await settleJob(worker, ctx.models, (await agent.post('/api/jobs').send({ ...IMAGE, prompt: '502' })).body.job.id);
  assert.equal(gateway.error.code, 'SUBMISSION_UNCERTAIN');
  mock.state.createQueue = ['no_task_id'];
  const noId = await settleJob(worker, ctx.models, (await agent.post('/api/jobs').send({ ...IMAGE, prompt: 'no id' })).body.job.id);
  assert.equal(noId.error.code, 'SUBMISSION_UNCERTAIN');
  assert.equal(mock.state.calls.create, 2);
});

test('retrying an uncertain job requires explicit confirmation', async () => {
  const { agent } = await userWithKey();
  mock.state.createQueue = ['server_error'];
  const res = await agent.post('/api/jobs').send({ ...IMAGE, prompt: 'server error' });
  const failed = await settleJob(worker, ctx.models, res.body.job.id);
  assert.equal(failed.error.code, 'SUBMISSION_UNCERTAIN');

  const blocked = await agent.post(`/api/jobs/${failed._id}/retry`).send({});
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error.code, 'CONFIRMATION_REQUIRED');

  const confirmed = await agent.post(`/api/jobs/${failed._id}/retry`).send({ confirmDuplicateRisk: true });
  assert.equal(confirmed.status, 202);
  assert.equal(confirmed.body.job.retryOf, String(failed._id));
  const retried = await settleJob(worker, ctx.models, confirmed.body.job.id);
  assert.equal(retried.status, 'completed');
});

test('provider-side generation failures are reported with the provider message', async () => {
  const { agent } = await userWithKey();
  mock.state.sequence = ['generating', 'fail'];
  mock.state.failMessage = 'Prompt violates content policy';
  const done = await settleJob(worker, ctx.models, (await agent.post('/api/jobs').send({ ...IMAGE, prompt: 'blocked' })).body.job.id);
  assert.equal(done.status, 'failed');
  assert.equal(done.error.code, 'PROVIDER_GENERATION_FAILED');
  assert.match(done.error.message, /content policy/);
});

test('restart recovery: a job interrupted mid-submission is reconciled, never resent', async () => {
  const { agent } = await userWithKey();
  const res = await agent.post('/api/jobs').send({ ...IMAGE, prompt: 'interrupted' });
  await ctx.models.GenerationJob.updateOne(
    { _id: res.body.job.id },
    { status: 'processing', phase: 'submitting', submitAttempts: 1, lockedBy: 'crashed-worker', lockedUntil: new Date(Date.now() - 1000) },
  );
  const { recoverInterruptedJobs } = await import('../../src/jobs/recovery.js');
  const recovered = await recoverInterruptedJobs();
  assert.ok(recovered.interrupted >= 1);
  const done = await settleJob(worker, ctx.models, res.body.job.id);
  assert.equal(done.status, 'failed');
  assert.equal(done.error.code, 'SUBMISSION_UNCERTAIN');
  assert.equal(mock.state.calls.create, 0);
});

test('restart recovery: a job that was polling resumes polling without resubmitting', async () => {
  const { agent } = await userWithKey();
  mock.state.sequence = ['generating', 'generating', 'generating', 'success'];
  const res = await agent.post('/api/jobs').send({ ...IMAGE, prompt: 'resume polling' });
  await worker.drain({ maxSteps: 1 }); // submits once and stores the provider task id
  const submitted = await ctx.models.GenerationJob.findById(res.body.job.id).lean();
  assert.equal(submitted.phase, 'polling');
  await ctx.models.GenerationJob.updateOne({ _id: submitted._id }, { lockedBy: 'crashed-worker', lockedUntil: new Date(Date.now() - 1000) });
  const done = await settleJob(worker, ctx.models, submitted._id);
  assert.equal(done.status, 'completed');
  assert.equal(done.providerTaskId, submitted.providerTaskId);
  assert.equal(mock.state.calls.create, 1);
});

test('per-user concurrency: a second job waits while the first is running', async () => {
  const { agent } = await userWithKey();
  mock.state.sequence = ['generating', 'generating', 'generating', 'generating', 'success'];
  const first = await agent.post('/api/jobs').send({ ...IMAGE, prompt: 'first' });
  const second = await agent.post('/api/jobs').send({ ...IMAGE, prompt: 'second' });
  await worker.drain({ maxSteps: 2 });
  const [a, b] = await Promise.all([
    ctx.models.GenerationJob.findById(first.body.job.id).lean(),
    ctx.models.GenerationJob.findById(second.body.job.id).lean(),
  ]);
  assert.equal(a.phase, 'polling');
  assert.equal(b.phase, 'pending_submit');
  assert.ok(b.events.some((e) => e.type === 'waiting_for_slot'));
  assert.equal(mock.state.calls.create, 1);
  assert.equal((await settleJob(worker, ctx.models, a._id)).status, 'completed');
  assert.equal((await settleJob(worker, ctx.models, b._id)).status, 'completed');
  assert.equal(mock.state.calls.create, 2);
});

test('two workers never submit the same job twice', async () => {
  const { createWorker } = await import('../../src/jobs/worker.js');
  const { logger } = await import('../../src/config/logger.js');
  const other = createWorker({ env: ctx.env, logger, workerId: 'test-worker-b' });
  const users = await Promise.all([userWithKey(), userWithKey(), userWithKey()]);
  const ids = [];
  for (const [index, { agent }] of users.entries()) {
    ids.push((await agent.post('/api/jobs').send({ ...IMAGE, prompt: `parallel ${index}` })).body.job.id);
  }
  await Promise.all([worker.drain(), other.drain(), worker.drain(), other.drain()]);
  for (const id of ids) await settleJob(worker, ctx.models, id);
  assert.equal(mock.state.calls.create, 3);
});

test('timeouts fail the job with an honest message', async () => {
  const { agent } = await userWithKey();
  mock.state.sequence = ['generating'];
  const res = await agent.post('/api/jobs').send({ ...IMAGE, prompt: 'never finishes' });
  await worker.drain({ maxSteps: 3 });
  await ctx.models.GenerationJob.updateOne({ _id: res.body.job.id }, { timeoutAt: new Date(Date.now() - 1000) });
  const done = await settleJob(worker, ctx.models, res.body.job.id);
  assert.equal(done.status, 'failed');
  assert.equal(done.error.code, 'TIMEOUT');
  assert.match(done.error.message, /may still be charged/);
});

test('cancelling: before submission nothing is sent; after submission polling stops', async () => {
  const { agent } = await userWithKey();
  const queued = await agent.post('/api/jobs').send({ ...IMAGE, prompt: 'cancel me early' });
  const cancelled = await agent.post(`/api/jobs/${queued.body.job.id}/cancel`);
  assert.equal(cancelled.body.job.status, 'cancelled');
  await worker.drain();
  assert.equal(mock.state.calls.create, 0);

  mock.state.sequence = ['generating', 'generating', 'generating', 'success'];
  const running = await agent.post('/api/jobs').send({ ...IMAGE, prompt: 'cancel me late' });
  await worker.drain({ maxSteps: 1 });
  await agent.post(`/api/jobs/${running.body.job.id}/cancel`);
  const done = await settleJob(worker, ctx.models, running.body.job.id);
  assert.equal(done.status, 'cancelled');
  assert.match(done.error.message, /may still finish/);
  assert.equal((await agent.post(`/api/jobs/${running.body.job.id}/cancel`)).status, 409);
});

test("jobs are owner-scoped", async () => {
  const alice = await userWithKey();
  const bob = await signupAgent(ctx.app);
  const job = (await alice.agent.post('/api/jobs').send({ ...IMAGE, prompt: 'private' })).body.job;
  assert.equal((await bob.agent.get(`/api/jobs/${job.id}`)).status, 404);
  assert.equal((await bob.agent.post(`/api/jobs/${job.id}/cancel`)).status, 404);
  assert.equal((await bob.agent.post(`/api/jobs/${job.id}/retry`).send({})).status, 404);
  assert.equal((await bob.agent.get('/api/jobs')).body.items.length, 0);
  assert.ok((await alice.agent.get('/api/jobs')).body.items.some((j) => j.id === job.id));
});

test('admins can list, cancel and retry jobs but see only a prompt preview', async () => {
  const owner = await userWithKey();
  const admin = await createAdminAgent(ctx.app, ctx.models);
  mock.state.createQueue = ['server_error'];
  const failed = await settleJob(worker, ctx.models, (await owner.agent.post('/api/jobs').send({ ...IMAGE, prompt: 'admin view prompt' })).body.job.id);
  const list = await admin.agent.get('/api/admin/jobs').query({ status: 'failed' });
  assert.equal(list.status, 200);
  const row = list.body.items.find((j) => j.id === String(failed._id));
  assert.equal(row.userEmail, owner.email);
  assert.deepEqual(Object.keys(row.request), ['promptPreview']);
  assert.ok(!JSON.stringify(list.body).includes(KEY));
  assert.equal((await admin.agent.post(`/api/admin/jobs/${failed._id}/retry`).send({})).status, 409);
  assert.equal((await admin.agent.post(`/api/admin/jobs/${failed._id}/retry`).send({ confirmDuplicateRisk: true })).status, 202);
  assert.equal((await owner.agent.get('/api/admin/jobs')).status, 403);
});
