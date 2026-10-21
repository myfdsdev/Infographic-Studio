// Reconciling an uncertain submission through the provider callback, with
// PUBLIC_WEBHOOK_BASE_URL configured.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { startMockKie } from '../fixtures/mockKie.js';
import { startTestEnvironment, signupAgent, settleJob } from '../fixtures/testEnvironment.js';

const KEY = 'kie_test_key_HOOK_0123456789abcdef';
const OTHER_KEY = 'kie_test_key_OTHR_0123456789abcdef';

let mock;
let ctx;
let worker;
before(async () => {
  mock = await startMockKie();
  ctx = await startTestEnvironment({
    KIE_API_BASE_URL: mock.url,
    PUBLIC_WEBHOOK_BASE_URL: 'https://api.infographic-studio.example',
    PROVIDER_SUBMIT_TIMEOUT_MS: '300',
    JOB_RECONCILE_MINUTES: '15',
  });
  const { createWorker } = await import('../../src/jobs/worker.js');
  const { logger } = await import('../../src/config/logger.js');
  worker = createWorker({ env: ctx.env, logger, workerId: 'hook-worker' });
});
after(async () => {
  await ctx?.stop();
  await mock?.stop();
});
beforeEach(async () => {
  await ctx.models.GenerationJob.updateMany(
    { status: { $in: ['queued', 'processing'] } },
    { $set: { status: 'cancelled', phase: 'done', lockedBy: null, lockedUntil: null } },
  );
  mock.reset();
  mock.state.validKeys = new Set([KEY, OTHER_KEY]);
});

async function uncertainJob(prompt = 'callback me') {
  const account = await signupAgent(ctx.app);
  await account.agent.put('/api/settings/credentials/kie').send({ apiKey: KEY });
  mock.state.createMode = 'hang';
  mock.state.hangMs = 900;
  const res = await account.agent.post('/api/jobs').send({ kind: 'image', model: 'nano-banana-2', prompt });
  // Other jobs may be claimed first; step until this one has been sent.
  let job;
  for (let step = 0; step < 50; step += 1) {
    await worker.drain({ maxSteps: 1 });
    job = await ctx.models.GenerationJob.findById(res.body.job.id).lean();
    if (!['pending_submit', 'submitting'].includes(job.phase)) break;
  }
  assert.equal(job.phase, 'reconcile');
  assert.equal(job.status, 'processing');
  const task = [...mock.state.tasks.values()].at(-1);
  return { account, job, task };
}

function callbackParts(task) {
  const url = new URL(task.callBackUrl);
  return url.pathname; // /api/webhooks/kie/<jobId>/<token>
}

test('the callback URL sent to the provider points at this job', async () => {
  const { job, task } = await uncertainJob();
  assert.ok(task.callBackUrl.startsWith(`https://api.infographic-studio.example/api/webhooks/kie/${job._id}/`));
});

test('a genuine callback reconciles the job, which then completes without a second submission', async () => {
  const { job, task } = await uncertainJob('genuine');
  const hook = await request(ctx.app).post(callbackParts(task)).send({ code: 200, data: { taskId: task.taskId, state: 'success' } });
  assert.equal(hook.status, 200);
  const reconciled = await ctx.models.GenerationJob.findById(job._id).lean();
  assert.equal(reconciled.providerTaskId, task.taskId);
  assert.equal(reconciled.phase, 'polling');
  const done = await settleJob(worker, ctx.models, job._id);
  assert.equal(done.status, 'completed');
  assert.equal(mock.state.calls.create, 1);
});

test('a callback with a wrong token is ignored (same 200 response)', async () => {
  const { job, task } = await uncertainJob('wrong token');
  const forged = `/api/webhooks/kie/${job._id}/${'x'.repeat(32)}`;
  const hook = await request(ctx.app).post(forged).send({ code: 200, data: { taskId: task.taskId } });
  assert.equal(hook.status, 200);
  assert.equal((await ctx.models.GenerationJob.findById(job._id).lean()).providerTaskId, null);
});

test("a callback naming another job's task is rejected after checking with the provider", async () => {
  const first = await uncertainJob('first');
  const second = await uncertainJob('second');
  // Correct URL/token for the first job, but the second job's task id.
  await request(ctx.app).post(callbackParts(first.task)).send({ code: 200, data: { taskId: second.task.taskId } });
  assert.equal((await ctx.models.GenerationJob.findById(first.job._id).lean()).providerTaskId, null);
});

test("a task from someone else's provider account is rejected", async () => {
  const { job, task } = await uncertainJob('foreign');
  // A task that exists, but under a different Kie.ai account.
  mock.state.tasks.set('task_foreign', { ...task, taskId: 'task_foreign', apiKey: OTHER_KEY, polls: 0 });
  await request(ctx.app).post(callbackParts(task)).send({ code: 200, data: { taskId: 'task_foreign' } });
  assert.equal((await ctx.models.GenerationJob.findById(job._id).lean()).providerTaskId, null);
});

test('the webhook token never appears in request logs', async () => {
  const pino = (await import('pino')).default;
  const lines = [];
  const { createApp } = await import('../../src/app.js');
  const loud = createApp({ env: ctx.env, logger: pino({ level: 'trace' }, { write: (line) => lines.push(line) }) });
  const { task } = await uncertainJob('log check');
  const path = callbackParts(task);
  const token = path.split('/').at(-1);
  await request(loud).post(path).send({ code: 200, data: { taskId: task.taskId } });
  assert.ok(lines.length > 0);
  assert.ok(!lines.join('\n').includes(token));
});
