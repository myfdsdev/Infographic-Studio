// Admin panel: admin-only access, real statistics, app-access and
// concurrency controls, provider model switches, generation and MCP
// monitoring, branding (settings, uploads, public endpoints), AI-connection
// revocation, sanitized failures and operational logs. Runs against a mock Kie.ai.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { startMockKie } from '../fixtures/mockKie.js';
import { makePng, makeJpeg } from '../fixtures/images.js';
import { startTestEnvironment, signupAgent, createAdminAgent, loginAgent, settleJob, settleInfographic, tokenFromResetEmail, STRONG_PASSWORD } from '../fixtures/testEnvironment.js';
import { connect, callTool } from '../fixtures/oauthFlow.js';

const KEY = 'kie_test_key_ADMN_0123456789abcdef';
// A secret-looking value the redaction must remove. Built at runtime so secret
// scanners (GitHub push protection) do not mistake this fake for a real key.
const FAKE_SECRET = ['sk', 'live', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'].join('_');

let mock;
let ctx;
let worker;
let admin;
before(async () => {
  mock = await startMockKie();
  ctx = await startTestEnvironment({ KIE_API_BASE_URL: mock.url, JOB_USER_CONCURRENCY: '4' });
  const { createWorker } = await import('../../src/jobs/worker.js');
  const { logger } = await import('../../src/config/logger.js');
  worker = createWorker({ env: ctx.env, logger, workerId: 'admin-worker' });
  admin = await createAdminAgent(ctx.app, ctx.models);
});
after(async () => {
  await ctx?.stop();
  await mock?.stop();
});
beforeEach(async () => {
  mock.state.validKeys = new Set([KEY]);
  mock.state.createQueue = [];
  mock.state.modelSequences = {};
  mock.state.brokenModels = new Set();
  mock.state.sequence = ['waiting', 'generating', 'success'];
  // Every test starts from the default platform settings.
  await ctx.models.AppSettings.deleteMany({ key: { $in: ['platform', 'branding'] } });
  const { __resetPlatformSettingsCache } = await import('../../src/services/platformSettings.service.js');
  const { __resetBrandingCache } = await import('../../src/services/branding.service.js');
  __resetPlatformSettingsCache();
  __resetBrandingCache();
});

async function settings(body) {
  const res = await admin.agent.patch('/api/admin/settings').send(body);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.settings;
}

async function userWithKey() {
  const account = await signupAgent(ctx.app);
  const saved = await account.agent.put('/api/settings/credentials/kie').send({ apiKey: KEY });
  assert.equal(saved.status, 200);
  return account;
}

const imageJob = { kind: 'image', model: 'nano-banana-2', prompt: 'A red bicycle leaning on a wall', aspectRatio: '1:1' };
const infographic = { topic: 'Five simple habits that help remote teams communicate better.', style: 'corporate', aspectRatio: '3:4' };

test('every admin endpoint is refused to users and to signed-out visitors', async () => {
  const user = await signupAgent(ctx.app);
  const endpoints = [
    ['get', '/api/admin/stats'],
    ['get', '/api/admin/system'],
    ['get', '/api/admin/failures'],
    ['get', '/api/admin/ops-logs'],
    ['get', '/api/admin/settings'],
    ['patch', '/api/admin/settings'],
    ['get', '/api/admin/providers'],
    ['put', '/api/admin/providers/kie/models'],
    ['get', '/api/admin/mcp/connections'],
    ['delete', `/api/admin/mcp/connections/${'a'.repeat(24)}`],
    ['get', '/api/admin/infographics'],
    ['get', '/api/admin/mcp/monitor'],
    ['get', '/api/admin/jobs'],
    ['get', '/api/admin/users'],
    ['get', '/api/admin/branding'],
    ['put', '/api/admin/branding'],
    ['post', '/api/admin/branding/logo'],
    ['post', '/api/admin/branding/reset'],
  ];
  for (const [method, path] of endpoints) {
    assert.equal((await user.agent[method](path).send({})).status, 403, `${method} ${path} as a user`);
    assert.equal((await request(ctx.app)[method](path).send({})).status, 401, `${method} ${path} signed out`);
  }
});

test('statistics are real counts from the database', async () => {
  const before = (await admin.agent.get('/api/admin/stats')).body.stats;
  const account = await userWithKey();
  const job = (await account.agent.post('/api/jobs').send(imageJob)).body.job;
  await settleJob(worker, ctx.models, job.id);
  const after = (await admin.agent.get('/api/admin/stats')).body.stats;
  assert.equal(after.users.total, before.users.total + 1);
  assert.equal(after.users.withProviderKey, before.users.withProviderKey + 1);
  assert.equal(after.jobs.completed, before.jobs.completed + 1);
  assert.equal(after.jobs.created24h, before.jobs.created24h + 1);
  assert.equal(after.totalUsers, await ctx.models.User.countDocuments({}));
  assert.equal(after.jobs.completed, await ctx.models.GenerationJob.countDocuments({ status: 'completed' }));
  assert.ok(!JSON.stringify(after).includes(KEY));

  const made = (await account.agent.post('/api/infographics').send(infographic)).body.infographic;
  await settleInfographic(worker, ctx.models, made.id);
  const withInfographic = (await admin.agent.get('/api/admin/stats')).body.stats;
  assert.equal(withInfographic.infographics.total, after.infographics.total + 1);
  assert.equal(withInfographic.infographics.completed, after.infographics.completed + 1);
  assert.equal(withInfographic.infographics.byStyle.corporate >= 1, true);

  const system = (await admin.agent.get('/api/admin/system')).body.system;
  assert.equal(system.database.connected, true);
  assert.equal(system.ffmpeg, undefined);
  assert.equal(system.worker.userConcurrency, 4);
});

test('app access: sign-ups closed, maintenance mode (admins still in), AI apps off', async () => {
  await settings({ access: { signupEnabled: false } });
  const refused = await request(ctx.app).post('/api/auth/signup').send({ name: 'Late', email: 'late@example.test', password: STRONG_PASSWORD });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error.code, 'SIGNUP_DISABLED');
  await settings({ access: { signupEnabled: true } });

  const member = await signupAgent(ctx.app);
  const { tokens } = await connect(ctx.app, member.agent);
  await settings({ access: { maintenanceMode: true, maintenanceMessage: 'Back at 6 pm.' } });

  const me = await member.agent.get('/api/auth/me');
  assert.equal(me.status, 503);
  assert.equal(me.body.error.code, 'MAINTENANCE');
  assert.equal(me.body.error.message, 'Back at 6 pm.');
  const login = await request(ctx.app).post('/api/auth/login').send({ email: member.email, password: STRONG_PASSWORD });
  assert.equal(login.status, 503);
  assert.equal((await member.agent.post('/api/auth/logout').send({})).status, 200, 'signing out still works');
  assert.equal((await admin.agent.get('/api/admin/stats')).status, 200, 'administrators keep access');
  assert.equal((await callTool(ctx.app, tokens.access_token, 'list_infographics')).res.status, 503, 'AI apps are paused too');

  await settings({ access: { maintenanceMode: false, mcpEnabled: false } });
  const blocked = await callTool(ctx.app, tokens.access_token, 'list_infographics');
  assert.equal(blocked.res.status, 503);
  await settings({ access: { mcpEnabled: true } });
  assert.equal((await callTool(ctx.app, tokens.access_token, 'list_infographics')).res.status, 200);

  const audit = await ctx.models.AuditLog.find({ action: 'admin.settings_updated' }).lean();
  assert.ok(audit.some((entry) => entry.metadata?.changes?.['access.maintenanceMode']));
});

test('pausing generation stops new provider calls everywhere, and resuming continues', async () => {
  const account = await userWithKey();
  const queued = (await account.agent.post('/api/jobs').send(imageJob)).body.job;
  const tasksBefore = mock.state.tasks.size;
  await settings({ access: { generationEnabled: false, generationPausedMessage: 'Paused for a provider outage.' } });

  const refused = await account.agent.post('/api/jobs').send(imageJob);
  assert.equal(refused.status, 503);
  assert.equal(refused.body.error.code, 'GENERATION_PAUSED');
  assert.equal(refused.body.error.message, 'Paused for a provider outage.');
  const blockedInfographic = await account.agent.post('/api/infographics').send(infographic);
  assert.equal(blockedInfographic.status, 503);
  assert.equal(blockedInfographic.body.error.code, 'GENERATION_PAUSED');

  // The job queued before the pause waits instead of being sent.
  await worker.drain();
  const waiting = await ctx.models.GenerationJob.findById(queued.id).lean();
  assert.equal(waiting.status, 'queued');
  assert.ok(waiting.events.some((event) => event.type === 'paused'));
  assert.equal(mock.state.tasks.size, tasksBefore);

  const { tokens } = await connect(ctx.app, account.agent);
  const tool = await callTool(ctx.app, tokens.access_token, 'generate_infographic', {
    topic: 'Why regular backups protect a small business.', style: 'minimal', aspect_ratio: '1:1', confirm_paid_generation: true,
  });
  assert.equal(tool.body.result.isError, true);
  assert.equal(tool.body.result.structuredContent.error.code, 'GENERATION_PAUSED');

  await settings({ access: { generationEnabled: true } });
  const done = await settleJob(worker, ctx.models, queued.id);
  assert.equal(done.status, 'completed');
});

test('per-user concurrency from the admin setting is applied by the worker', async () => {
  await settings({ limits: { userConcurrency: 1 } });
  const account = await userWithKey();
  mock.state.sequence = ['waiting', 'generating', 'generating', 'generating', 'generating', 'success'];
  const first = (await account.agent.post('/api/jobs').send(imageJob)).body.job;
  const second = (await account.agent.post('/api/jobs').send({ ...imageJob, prompt: 'A blue bicycle by the sea' })).body.job;
  for (let round = 0; round < 3; round += 1) await worker.drain();
  const states = await ctx.models.GenerationJob.find({ _id: { $in: [first.id, second.id] } }).lean();
  const waiting = states.find((job) => job.events.some((event) => event.type === 'waiting_for_slot'));
  // With the environment default (4) neither job would wait; the admin limit of 1 makes one wait.
  assert.ok(waiting, 'the second job waits for a free slot');
  await settings({ limits: { userConcurrency: 4 } });
  assert.equal((await settleJob(worker, ctx.models, first.id)).status, 'completed');
  assert.equal((await settleJob(worker, ctx.models, second.id)).status, 'completed');

  const invalid = await admin.agent.patch('/api/admin/settings').send({ limits: { userConcurrency: 0 } });
  assert.equal(invalid.status, 400);
});

test('turning a model off refuses it everywhere, and is audited', async () => {
  const account = await userWithKey();
  const providers = (await admin.agent.get('/api/admin/providers')).body.providers;
  const zImage = providers[0].models.find((model) => model.id === 'z-image');
  assert.equal(zImage.enabled, true);
  assert.deepEqual(zImage.usedFor, ['Infographic generation']);
  assert.ok(providers[0].models.every((model) => model.kind === 'image'));
  assert.ok(!JSON.stringify(providers).includes(KEY));

  const off = await admin.agent.put('/api/admin/providers/kie/models').send({ model: 'z-image', enabled: false });
  assert.equal(off.status, 200);
  assert.equal(off.body.providers[0].models.find((model) => model.id === 'z-image').enabled, false);

  const job = await account.agent.post('/api/jobs').send({ ...imageJob, model: 'z-image' });
  assert.equal(job.status, 400);
  assert.equal(job.body.error.code, 'MODEL_DISABLED');
  const refused = await account.agent.post('/api/infographics').send(infographic);
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error.code, 'MODEL_DISABLED');

  assert.equal((await admin.agent.put('/api/admin/providers/kie/models').send({ model: 'not/a-model', enabled: false })).status, 404);
  await admin.agent.put('/api/admin/providers/kie/models').send({ model: 'z-image', enabled: true });
  assert.equal((await account.agent.post('/api/infographics').send(infographic)).status, 202);
  const audit = await ctx.models.AuditLog.find({ action: { $in: ['admin.model_disabled', 'admin.model_enabled'] } }).lean();
  assert.equal(audit.length >= 2, true);
});

test('generation monitoring: every user\'s infographics, filtered by status, errors redacted, no prompts', async () => {
  const account = await userWithKey();
  const good = (await account.agent.post('/api/infographics').send({ ...infographic, style: 'minimal' })).body.infographic;
  await settleInfographic(worker, ctx.models, good.id);
  mock.state.sequence = ['waiting', 'fail'];
  mock.state.failMessage = `Rejected with api_key=${FAKE_SECRET}`;
  const bad = (await account.agent.post('/api/infographics').send({ ...infographic, style: 'colorful' })).body.infographic;
  await settleInfographic(worker, ctx.models, bad.id);
  mock.state.failMessage = undefined;

  const all = await admin.agent.get('/api/admin/infographics').query({ search: account.email });
  assert.equal(all.status, 200);
  assert.equal(all.body.total, 2);
  assert.ok(all.body.items.every((item) => item.userEmail === account.email));
  const failed = await admin.agent.get('/api/admin/infographics').query({ search: account.email, status: 'failed' });
  assert.deepEqual(failed.body.items.map((item) => item.id), [bad.id]);
  const text = JSON.stringify(all.body);
  assert.ok(!text.includes(FAKE_SECRET));
  assert.ok(!text.includes('Accuracy rules'), 'the full provider prompt is not listed');
  assert.ok(all.body.items.every((item) => item.topic === undefined && item.prompt === undefined));
  assert.ok(!text.includes(KEY));
});

test('MCP monitoring: connections, tool calls and failures per tool', async () => {
  const member = await signupAgent(ctx.app);
  const { tokens } = await connect(ctx.app, member.agent);
  await callTool(ctx.app, tokens.access_token, 'list_infographics');
  await callTool(ctx.app, tokens.access_token, 'generate_infographic', {
    topic: 'How to plan a week of healthy lunches.', style: 'colorful', aspect_ratio: '9:16', confirm_paid_generation: true,
  });
  const res = await admin.agent.get('/api/admin/mcp/monitor');
  assert.equal(res.status, 200);
  const { monitor } = res.body;
  assert.equal(monitor.enabled, true);
  assert.ok(monitor.connections.active >= 1);
  const generate = monitor.tools.find((row) => row.tool === 'generate_infographic');
  assert.ok(generate && generate.failures >= 1, 'a call without a key is counted as a failure');
  assert.ok(monitor.tools.some((row) => row.tool === 'list_infographics' && row.calls >= 1));
  assert.ok(monitor.recentFailures.some((row) => row.tool === 'generate_infographic' && row.code === 'NO_API_KEY' && row.userEmail === member.email));
  assert.ok(!JSON.stringify(monitor).includes(tokens.access_token));
});

test('branding: defaults, saved settings, image uploads served publicly, validation, reset', async () => {
  const defaults = (await request(ctx.app).get('/api/branding')).body.branding;
  assert.equal(defaults.appName, 'AI Infographic Studio');
  assert.equal(defaults.accentColor, '#7665e8');
  assert.equal(defaults.logoPath, null, 'the client uses the supplied logo.png');
  assert.equal(defaults.faviconPath, null);

  assert.equal((await admin.agent.put('/api/admin/branding').send({ accentColor: 'red' })).status, 400);
  assert.equal((await admin.agent.put('/api/admin/branding').send({ appName: 'X' })).status, 400);
  const saved = await admin.agent.put('/api/admin/branding').send({ appName: 'Nova Studio', tagline: 'Creators first', accentColor: '#7C3AED' });
  assert.equal(saved.status, 200);
  const publicView = (await request(ctx.app).get('/api/branding')).body.branding;
  assert.equal(publicView.appName, 'Nova Studio');
  assert.equal(publicView.accentColor, '#7c3aed');

  const logo = await admin.agent.post('/api/admin/branding/logo').attach('file', makePng(400, 120, { text: 'SECRET-LOGO-META' }), { filename: 'logo.png', contentType: 'image/png' });
  assert.equal(logo.status, 201, JSON.stringify(logo.body));
  const logoPath = logo.body.branding.logoPath;
  assert.match(logoPath, /^\/branding\/logo\?v=\d+$/);
  const served = await request(ctx.app).get(`/api${logoPath}`).buffer(true).parse((res, cb) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  assert.equal(served.status, 200);
  assert.equal(served.headers['content-type'], 'image/png');
  assert.equal(served.headers['x-content-type-options'], 'nosniff');
  assert.equal(served.headers['cross-origin-resource-policy'], 'cross-origin');
  assert.match(served.headers['cache-control'], /immutable/);
  assert.ok(!served.body.includes('SECRET-LOGO-META'), 'metadata removed');

  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.equal((await admin.agent.post('/api/admin/branding/logo').attach('file', svg, { filename: 'x.svg', contentType: 'image/svg+xml' })).status, 400);
  const wide = await admin.agent.post('/api/admin/branding/favicon').attach('file', makePng(200, 64), { filename: 'f.png', contentType: 'image/png' });
  assert.equal(wide.status, 400);
  assert.equal(wide.body.error.code, 'FAVICON_NOT_SQUARE');
  const favicon = await admin.agent.post('/api/admin/branding/favicon').attach('file', makeJpeg(64, 64, { orientation: 1 }), { filename: 'f.jpg', contentType: 'image/jpeg' });
  assert.equal(favicon.status, 201, JSON.stringify(favicon.body));
  assert.equal((await request(ctx.app).get('/api/branding/favicon')).status, 200);

  // The app name reaches emails too.
  const member = await signupAgent(ctx.app);
  ctx.email.clearSentEmails();
  await request(ctx.app).post('/api/auth/forgot-password').send({ email: member.email });
  const mail = ctx.email.getSentEmails().at(-1);
  assert.match(mail.subject, /Nova Studio/);
  assert.ok(tokenFromResetEmail(mail));

  const resetLogo = await admin.agent.delete('/api/admin/branding/logo');
  assert.equal(resetLogo.body.branding.logoPath, null);
  assert.equal((await request(ctx.app).get('/api/branding/logo')).status, 404);
  const resetAll = await admin.agent.post('/api/admin/branding/reset').send({});
  assert.equal(resetAll.body.branding.appName, 'AI Infographic Studio');
  assert.equal(resetAll.body.branding.faviconPath, null);
  const actions = (await ctx.models.AuditLog.find({ action: /^admin\.branding/ }).lean()).map((entry) => entry.action);
  for (const action of ['admin.branding_updated', 'admin.branding_logo_uploaded', 'admin.branding_favicon_uploaded', 'admin.branding_logo_reset', 'admin.branding_reset']) {
    assert.ok(actions.includes(action), action);
  }
});

test('administrators see and revoke any AI connection; user details never include keys', async () => {
  const member = await userWithKey();
  const { tokens, connection } = await connect(ctx.app, member.agent);
  const list = await admin.agent.get('/api/admin/mcp/connections').query({ search: member.email });
  assert.equal(list.status, 200);
  const row = list.body.items.find((item) => item.id === connection.id);
  assert.equal(row.userEmail, member.email);

  const details = await admin.agent.get(`/api/admin/users/${member.user.id}`);
  assert.equal(details.body.mcpConnections.length, 1);
  assert.equal(details.body.usage.jobs, 0);
  for (const key of Object.keys(details.body.credentials[0])) assert.ok(['provider', 'status', 'lastVerifiedAt', 'updatedAt'].includes(key), key);
  assert.ok(!JSON.stringify(details.body).includes(KEY));
  assert.ok(!JSON.stringify(details.body).includes(KEY.slice(-4)));

  const revoked = await admin.agent.delete(`/api/admin/mcp/connections/${connection.id}`);
  assert.equal(revoked.status, 200);
  assert.equal(revoked.body.connection.revokedReason, 'admin');
  assert.equal((await callTool(ctx.app, tokens.access_token, 'list_infographics')).res.status, 401);
  assert.ok(await ctx.models.AuditLog.exists({ action: 'admin.mcp_connection_revoked' }));
});

test('failures are grouped and their messages redacted', async () => {
  const account = await userWithKey();
  mock.state.sequence = ['waiting', 'fail'];
  mock.state.failMessage = `Upstream rejected request with api_key=${FAKE_SECRET} at https://cdn.example.test/out.png?X-Amz-Signature=abcdef1234567890`;
  const job = (await account.agent.post('/api/jobs').send(imageJob)).body.job;
  const failed = await settleJob(worker, ctx.models, job.id);
  assert.equal(failed.status, 'failed');
  mock.state.failMessage = undefined;

  const failures = (await admin.agent.get('/api/admin/failures?days=1')).body;
  const group = failures.jobs.find((item) => item.code === failed.error.code);
  assert.ok(group && group.count >= 1);
  const text = JSON.stringify(failures);
  assert.ok(!text.includes(FAKE_SECRET));
  assert.ok(!text.includes('X-Amz-Signature=abcdef'));
  assert.ok(failures.recentJobs.some((item) => item.id === job.id && item.userEmail === account.email));
});

test('operational log: warnings and server errors are kept and redacted; client errors are not', async () => {
  const { createOpsLogStream, flushOpsLog } = await import('../../src/config/opsLog.js');
  const stream = createOpsLogStream();
  const lines = [
    { level: 50, time: Date.now(), msg: 'Provider call failed with token=abcdefghijklmnopqrstuvwxyz0123456789', reason: 'Bearer abcdefghijklmnop0123456789', jobId: 'job-1' },
    { level: 40, time: Date.now(), msg: 'request completed', req: { method: 'GET', url: '/api/auth/me' }, res: { statusCode: 401 } },
    { level: 50, time: Date.now(), msg: 'request errored', req: { method: 'POST', url: '/api/jobs' }, res: { statusCode: 500 } },
    { level: 30, time: Date.now(), msg: 'just information' },
    { level: 40, time: Date.now(), msg: 'Recovered interrupted jobs', interrupted: 2, apiKey: 'kie_should_not_be_here_123456789' },
  ];
  stream.write(`${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
  await flushOpsLog();

  const res = await admin.agent.get('/api/admin/ops-logs');
  assert.equal(res.status, 200);
  const messages = res.body.items.map((item) => item.message);
  assert.ok(messages.some((message) => message.startsWith('Provider call failed')));
  assert.ok(messages.includes('request errored'));
  assert.ok(messages.includes('Recovered interrupted jobs'));
  assert.ok(!messages.includes('request completed'), '4xx request logs are skipped');
  assert.ok(!messages.includes('just information'));
  const text = JSON.stringify(res.body);
  assert.ok(!text.includes('abcdefghijklmnopqrstuvwxyz0123456789'));
  assert.ok(!text.includes('kie_should_not_be_here'));
  const errors = await admin.agent.get('/api/admin/ops-logs?level=error');
  assert.ok(errors.body.items.every((item) => item.level === 'error'));
});

test('an admin can still sign in during maintenance', async () => {
  await settings({ access: { maintenanceMode: true } });
  const relogin = await loginAgent(ctx.app, { email: admin.user.email });
  assert.equal((await relogin.agent.get('/api/auth/me')).status, 200);
  await settings({ access: { maintenanceMode: false } });
});

