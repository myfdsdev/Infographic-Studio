// MCP tools against a mock Kie.ai: every tool runs as the token's user through
// the same infographic service as the dashboard. Ownership isolation,
// paid-generation confirmation, strict BYOK, idempotent retries, status and
// history. The mock returns placeholder images, never real generations.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startMockKie } from '../fixtures/mockKie.js';
import { startTestEnvironment, signupAgent, settleInfographic } from '../fixtures/testEnvironment.js';
import { connect, callTool, mcpPost, rpcBody } from '../fixtures/oauthFlow.js';

const KEY = 'kie_test_key_MCPT_0123456789abcdef';
const TOPIC = 'Create an infographic explaining 5 benefits of AI automation for small businesses.';
const REQUEST = { topic: TOPIC, style: 'corporate', aspect_ratio: '3:4', confirm_paid_generation: true };

let mock;
let ctx;
let worker;
before(async () => {
  mock = await startMockKie();
  ctx = await startTestEnvironment({ KIE_API_BASE_URL: mock.url, JOB_USER_CONCURRENCY: '4' });
  const { createWorker } = await import('../../src/jobs/worker.js');
  const { logger } = await import('../../src/config/logger.js');
  worker = createWorker({ env: ctx.env, logger, workerId: 'mcp-worker' });
});
after(async () => {
  await ctx?.stop();
  await mock?.stop();
});
beforeEach(() => {
  mock.state.validKeys = new Set([KEY]);
  mock.state.createQueue = [];
  mock.state.modelSequences = {};
  mock.state.brokenModels = new Set();
  mock.state.fileMode = 'ok';
  mock.state.sequence = ['waiting', 'generating', 'success'];
});

function ok(call) {
  assert.equal(call.res.status, 200, call.res.text);
  assert.ok(!call.body.result.isError, JSON.stringify(call.body.result));
  return call.body.result.structuredContent;
}

function toolError(call) {
  assert.equal(call.res.status, 200, call.res.text);
  assert.equal(call.body.result.isError, true, JSON.stringify(call.body.result));
  return call.body.result.structuredContent.error;
}

async function connectedUser({ withKey = true, scopes } = {}) {
  const account = await signupAgent(ctx.app);
  if (withKey) {
    const saved = await account.agent.put('/api/settings/credentials/kie').send({ apiKey: KEY });
    assert.equal(saved.status, 200);
  }
  const { tokens } = await connect(ctx.app, account.agent, scopes ? { scopes } : {});
  return { ...account, token: tokens.access_token };
}

test('tools/list registers exactly the four infographic tools', async () => {
  const alice = await connectedUser();
  const res = await mcpPost(ctx.app, alice.token, { method: 'tools/list', params: {} });
  assert.equal(res.status, 200);
  const names = rpcBody(res).result.tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, ['generate_infographic', 'get_generation_status', 'get_infographic', 'list_infographics']);
});

test('generate_infographic runs on the user\'s own key and is tracked by get_generation_status', async () => {
  const alice = await connectedUser();
  const started = ok(await callTool(ctx.app, alice.token, 'generate_infographic', REQUEST));
  assert.match(started.infographic_id, /^[a-f0-9]{24}$/);
  assert.equal(started.style, 'corporate');
  assert.equal(started.aspect_ratio, '3:4');
  assert.equal(started.source, 'mcp');
  assert.equal(started.deduplicated, false);
  assert.ok(['queued', 'processing'].includes(started.status));

  const running = ok(await callTool(ctx.app, alice.token, 'get_generation_status', { infographic_id: started.infographic_id }));
  assert.equal(running.finished, false);

  const settled = await settleInfographic(worker, ctx.models, started.infographic_id);
  assert.equal(settled.status, 'completed');

  // The provider saw this user's key, the documented fields and the chosen ratio.
  const task = [...mock.state.tasks.values()].at(-1);
  assert.equal(task.apiKey, KEY);
  assert.equal(task.model, 'z-image');
  assert.equal(task.input.aspect_ratio, '3:4');
  assert.ok(task.input.prompt.includes(TOPIC));

  const done = ok(await callTool(ctx.app, alice.token, 'get_generation_status', { infographic_id: started.infographic_id }));
  assert.equal(done.finished, true);
  assert.equal(done.status, 'completed');
  assert.equal(done.image.width, 384);
  assert.equal(done.image.height, 512);
  assert.equal(done.image.mime_type, 'image/png');
  assert.equal(done.web_url, `http://localhost:5173/generations/${started.infographic_id}`);
  assert.ok(!JSON.stringify(done).includes(KEY));

  const details = ok(await callTool(ctx.app, alice.token, 'get_infographic', { infographic_id: started.infographic_id }));
  assert.equal(details.topic, TOPIC);
  assert.equal(details.model, 'z-image');

  const list = ok(await callTool(ctx.app, alice.token, 'list_infographics'));
  assert.equal(list.total, 1);
  assert.equal(list.infographics[0].infographic_id, started.infographic_id);
  assert.equal(list.infographics[0].has_image, true);
});

test('generation needs explicit paid confirmation and valid input', async () => {
  const alice = await connectedUser();
  const before = mock.state.calls.create;
  const { confirm_paid_generation: _omit, ...unconfirmed } = REQUEST;
  for (const args of [unconfirmed, { ...REQUEST, style: 'neon' }, { ...REQUEST, aspect_ratio: '16:9' }, { ...REQUEST, topic: 'short' }]) {
    const call = await callTool(ctx.app, alice.token, 'generate_infographic', args);
    assert.equal(call.body.result?.isError ?? Boolean(call.body.error), true, JSON.stringify(args));
  }
  assert.equal(await ctx.models.Infographic.countDocuments({ userId: alice.user.id }), 0);
  assert.equal(mock.state.calls.create, before);
});

test('strict BYOK: no key, or a rejected key, starts nothing', async () => {
  const noKey = await connectedUser({ withKey: false });
  const missing = toolError(await callTool(ctx.app, noKey.token, 'generate_infographic', REQUEST));
  assert.equal(missing.code, 'NO_API_KEY');

  const rejected = await connectedUser();
  await ctx.models.ApiCredential.updateOne({ userId: rejected.user.id }, { $set: { status: 'invalid' } });
  const invalid = toolError(await callTool(ctx.app, rejected.token, 'generate_infographic', REQUEST));
  assert.equal(invalid.code, 'API_KEY_INVALID');

  // Another user's key is never used as a fallback.
  const other = await connectedUser();
  assert.ok(other);
  assert.equal(await ctx.models.Infographic.countDocuments({ userId: { $in: [noKey.user.id, rejected.user.id] } }), 0);
  assert.equal(await ctx.models.GenerationJob.countDocuments({ userId: { $in: [noKey.user.id, rejected.user.id] } }), 0);
});

test('a retried call with the same idempotency key is not generated twice', async () => {
  const alice = await connectedUser();
  const args = { ...REQUEST, idempotency_key: 'retry-key-0001' };
  const first = ok(await callTool(ctx.app, alice.token, 'generate_infographic', args));
  const second = ok(await callTool(ctx.app, alice.token, 'generate_infographic', args));
  assert.equal(second.infographic_id, first.infographic_id);
  assert.equal(second.deduplicated, true);
  await settleInfographic(worker, ctx.models, first.infographic_id);
  assert.equal(await ctx.models.Infographic.countDocuments({ userId: alice.user.id }), 1);
});

test('users only ever see their own infographics', async () => {
  const alice = await connectedUser();
  const bob = await connectedUser();
  const started = ok(await callTool(ctx.app, alice.token, 'generate_infographic', REQUEST));
  await settleInfographic(worker, ctx.models, started.infographic_id);

  assert.equal(toolError(await callTool(ctx.app, bob.token, 'get_infographic', { infographic_id: started.infographic_id })).code, 'NOT_FOUND');
  assert.equal(toolError(await callTool(ctx.app, bob.token, 'get_generation_status', { infographic_id: started.infographic_id })).code, 'NOT_FOUND');
  assert.equal(ok(await callTool(ctx.app, bob.token, 'list_infographics')).total, 0);
  const bad = await callTool(ctx.app, bob.token, 'get_infographic', { infographic_id: 'nope' });
  assert.ok(bad.body.result?.isError || bad.body.error);
});

test('a read-only connection can list but cannot generate', async () => {
  const alice = await connectedUser({ scopes: ['infographics:read'] });
  assert.equal(ok(await callTool(ctx.app, alice.token, 'list_infographics')).total, 0);
  const res = await mcpPost(ctx.app, alice.token, { method: 'tools/call', params: { name: 'generate_infographic', arguments: REQUEST } });
  assert.equal(res.status, 403);
  assert.match(res.headers['www-authenticate'] || '', /insufficient_scope/);
  assert.equal(await ctx.models.Infographic.countDocuments({ userId: alice.user.id }), 0);
});

test('tool calls are audited with the topic reduced to its length', async () => {
  const alice = await connectedUser();
  ok(await callTool(ctx.app, alice.token, 'generate_infographic', REQUEST));
  const entry = await ctx.models.AuditLog.findOne({ action: 'mcp.tool.generate_infographic', actorId: alice.user.id }).lean();
  assert.ok(entry);
  assert.equal(entry.metadata.args.topic, `[text, ${TOPIC.length} chars]`);
  assert.ok(!JSON.stringify(entry).includes(KEY));
});
