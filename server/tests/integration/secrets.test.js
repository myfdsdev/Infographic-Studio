// Secrets never leave the server: run real flows with debug logging on and
// check that no provider key, password, session cookie, reset token, OAuth
// token or server secret appears in the log output or in API responses.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { startMockKie } from '../fixtures/mockKie.js';
import { startTestEnvironment, signupAgent, createAdminAgent, settleJob, settleInfographic, tokenFromResetEmail, STRONG_PASSWORD } from '../fixtures/testEnvironment.js';
import { connect, callTool, refresh } from '../fixtures/oauthFlow.js';

const KEY = 'kie_test_key_SCRT_9f8e7d6c5b4a39281706';
const NEW_PASSWORD = 'Brandnew2026Secret';

const captured = [];
const originalWrite = process.stdout.write.bind(process.stdout);
let mock;
let ctx;
let worker;
const responses = [];

before(async () => {
  // Keep the logger's JSON lines (they start with {"level":) and let
  // everything else, such as the test runner's own output, through.
  process.stdout.write = (chunk, ...rest) => {
    const text = String(chunk);
    if (text.startsWith('{"level":')) {
      captured.push(text);
      return true;
    }
    return originalWrite(chunk, ...rest);
  };
  mock = await startMockKie();
  ctx = await startTestEnvironment({ KIE_API_BASE_URL: mock.url, LOG_LEVEL: 'debug' });
  const { createWorker } = await import('../../src/jobs/worker.js');
  const { logger } = await import('../../src/config/logger.js');
  worker = createWorker({ env: ctx.env, logger, workerId: 'secrets-worker' });
  mock.state.validKeys = new Set([KEY]);
});
after(async () => {
  process.stdout.write = originalWrite;
  await ctx?.stop();
  await mock?.stop();
});

function keep(res) {
  responses.push(JSON.stringify({ body: res.body, headers: res.headers }));
  return res;
}

test('real flows with debug logging leak no secret into logs or responses', async () => {
  const user = await signupAgent(ctx.app);
  const cookie = (await request(ctx.app).post('/api/auth/login').send({ email: user.email, password: STRONG_PASSWORD })).headers['set-cookie'][0];
  const sessionValue = cookie.split(';')[0].split('=')[1];

  keep(await user.agent.put('/api/settings/credentials/kie').send({ apiKey: KEY }));
  keep(await user.agent.post('/api/settings/credentials/kie/verify').send({}));
  keep(await user.agent.get('/api/settings/credentials'));
  const job = keep(await user.agent.post('/api/jobs').send({ kind: 'image', model: 'nano-banana-2', prompt: 'A lighthouse at dusk', aspectRatio: '1:1' })).body.job;
  await settleJob(worker, ctx.models, job.id);
  keep(await user.agent.get(`/api/jobs/${job.id}`));

  // Password reset with a real emailed token.
  ctx.email.clearSentEmails();
  await request(ctx.app).post('/api/auth/forgot-password').send({ email: user.email });
  const resetToken = tokenFromResetEmail(ctx.email.getSentEmails().at(-1));
  assert.ok(resetToken);
  keep(await request(ctx.app).post('/api/auth/reset-password').send({ token: resetToken, password: NEW_PASSWORD }));

  // MCP: OAuth tokens and tool calls.
  const fresh = await signupAgent(ctx.app);
  await fresh.agent.put('/api/settings/credentials/kie').send({ apiKey: KEY });
  const { client, tokens } = await connect(ctx.app, fresh.agent);
  keep((await callTool(ctx.app, tokens.access_token, 'list_infographics')).res);
  const generated = await callTool(ctx.app, tokens.access_token, 'generate_infographic', {
    topic: 'Five benefits of AI automation for small businesses',
    style: 'minimal',
    aspect_ratio: '1:1',
    confirm_paid_generation: true,
  });
  keep(generated.res);
  const infographicId = generated.body?.result?.structuredContent?.infographic_id;
  assert.ok(infographicId, 'generate_infographic returned an id');
  await settleInfographic(worker, ctx.models, infographicId);
  keep((await callTool(ctx.app, tokens.access_token, 'get_generation_status', { infographic_id: infographicId })).res);
  const rotated = keep(await refresh(ctx.app, { clientId: client.client_id, refreshToken: tokens.refresh_token })).body;

  // Admin views of the same accounts.
  const admin = await createAdminAgent(ctx.app, ctx.models);
  keep(await admin.agent.get(`/api/admin/users/${fresh.user.id}`));
  keep(await admin.agent.get('/api/admin/stats'));
  keep(await admin.agent.get('/api/admin/providers'));
  keep(await admin.agent.get('/api/admin/jobs'));
  keep(await admin.agent.get('/api/admin/mcp/connections'));
  keep(await admin.agent.get('/api/admin/mcp/monitor'));
  keep(await admin.agent.get('/api/admin/infographics'));
  keep(await admin.agent.get('/api/admin/audit-logs'));

  const { flushOpsLog } = await import('../../src/config/opsLog.js');
  await flushOpsLog();
  keep(await admin.agent.get('/api/admin/ops-logs'));

  const logs = captured.join('');
  assert.ok(captured.length > 20, `the logger produced output (${captured.length} lines)`);
  const secrets = {
    'provider key': KEY,
    'provider key tail': KEY.slice(-8),
    password: STRONG_PASSWORD,
    'new password': NEW_PASSWORD,
    'session cookie': sessionValue,
    'reset token': resetToken,
    'access token': tokens.access_token,
    'refresh token': tokens.refresh_token,
    'rotated access token': rotated.access_token,
    'rotated refresh token': rotated.refresh_token,
    'session secret': ctx.env.SESSION_SECRET,
    'encryption key': ctx.env.ENCRYPTION_KEY,
  };
  for (const [label, value] of Object.entries(secrets)) {
    assert.ok(!logs.includes(value), `${label} found in the server log`);
  }
  const bodies = responses.join('\n');
  for (const [label, value] of Object.entries(secrets)) {
    if (label.includes('token') && !label.includes('reset')) continue; // the token endpoint returns tokens to their client
    assert.ok(!bodies.includes(value), `${label} found in an API response`);
  }
  for (const field of ['encryptedKey', 'passwordHash', 'tokenHash', 'ciphertext']) {
    assert.ok(!bodies.includes(field), `${field} found in an API response`);
  }
});
