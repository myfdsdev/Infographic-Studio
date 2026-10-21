// Shared-bucket mode (STORAGE_ALLOW_SHARED_BUCKET=true with STORAGE_KEY_PREFIX):
// the app writes, reads and deletes only inside its own folder, and another
// application's files in the same bucket are never touched.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { startMockS3 } from '../fixtures/mockS3.js';
import { startMockKie } from '../fixtures/mockKie.js';
import { startTestEnvironment, signupAgent, getBytes, settleInfographic } from '../fixtures/testEnvironment.js';

const KEY = 'kie_test_key_SHRD_0123456789abcdef';

const OTHER_APP = ['character_image/u1/a.png', 'uploads/u2/b.png', 'generated-videos/u3/c.mp4', 'users/someone/else.png'];

let s3;
let mock;
let ctx;
let worker;
before(async () => {
  s3 = await startMockS3({ bucket: 'shared-bucket' });
  mock = await startMockKie();
  mock.state.validKeys = new Set([KEY]);
  for (const key of OTHER_APP) {
    s3.state.objects.set(key, { body: Buffer.from(`other app ${key}`), contentType: 'image/png', etag: 'x', modified: new Date() });
  }
  ctx = await startTestEnvironment({
    KIE_API_BASE_URL: mock.url,
    STORAGE_DRIVER: 's3',
    S3_ENDPOINT: s3.url,
    S3_BUCKET: 'shared-bucket',
    S3_ACCESS_KEY_ID: 'test-access-key-0002',
    S3_SECRET_ACCESS_KEY: 'test-secret-key-0123456789abcdef0123456789',
    STORAGE_ALLOW_SHARED_BUCKET: 'true',
    STORAGE_KEY_PREFIX: 'studio/',
  });
  const { createWorker } = await import('../../src/jobs/worker.js');
  const { logger } = await import('../../src/config/logger.js');
  worker = createWorker({ env: ctx.env, logger, workerId: 'shared-worker' });
});
after(async () => {
  await ctx?.stop();
  await mock?.stop();
  await s3?.stop();
});

async function makeInfographic(agent, { withKey = true } = {}) {
  if (withKey) await agent.put('/api/settings/credentials/kie').send({ apiKey: KEY });
  const created = await agent.post('/api/infographics').send({ topic: 'Four tips for a tidy shared drive.', style: 'colorful', aspectRatio: '9:16' });
  assert.equal(created.status, 202, JSON.stringify(created.body));
  return settleInfographic(worker, ctx.models, created.body.infographic.id);
}

function otherAppUntouched() {
  for (const key of OTHER_APP) {
    assert.equal(s3.state.objects.get(key)?.body.toString(), `other app ${key}`, key);
  }
}

test('sharing a bucket without a key prefix is rejected by configuration', async () => {
  const { loadEnv } = await import('../../src/config/env.js');
  const base = { ...process.env, STORAGE_ALLOW_SHARED_BUCKET: 'true', STORAGE_KEY_PREFIX: '' };
  assert.throws(() => loadEnv(base), /STORAGE_KEY_PREFIX/);
  assert.throws(() => loadEnv({ ...process.env, STORAGE_KEY_PREFIX: 'Studio' }), /STORAGE_KEY_PREFIX/);
  assert.doesNotThrow(() => loadEnv({ ...process.env }));
});

test('readiness is ok in shared mode and still reports that the bucket is shared', async () => {
  const res = await request(ctx.app).get('/api/ready');
  assert.equal(res.status, 200);
  assert.equal(res.body.checks.storage.reachable, true);
  assert.equal(res.body.checks.storage.dedicated, false);
  assert.equal(res.body.checks.storage.keyPrefix, 'studio/');
  assert.equal(res.body.checks.storage.ok, true);
});

test('saved infographics land inside the app folder and are deleted from there only', async () => {
  const { agent } = await signupAgent(ctx.app);
  const item = await makeInfographic(agent);
  assert.equal(item.status, 'completed');
  const row = await ctx.models.Asset.findById(item.image.assetId).lean();
  assert.match(row.storageKey, /^studio\/users\/[a-f0-9]{24}\/infographic-image\//);
  assert.ok(s3.state.objects.has(row.storageKey));
  assert.equal((await getBytes(agent, `/api/infographics/${item._id}/image`)).status, 200);

  assert.equal((await agent.delete(`/api/infographics/${item._id}`)).status, 200);
  assert.equal(s3.state.objects.has(row.storageKey), false);
  otherAppUntouched();
  const outside = [...s3.state.objects.keys()].filter((key) => !OTHER_APP.includes(key) && !key.startsWith('studio/'));
  assert.deepEqual(outside, [], 'nothing written outside studio/');
});

test('the storage layer refuses any key outside the app folder', async () => {
  const storage = await import('../../src/services/storage.service.js');
  await assert.rejects(storage.putObject('uploads/u2/b.png', Buffer.from('overwrite attempt')), (error) => error.code === 'STORAGE_KEY_OUTSIDE_PREFIX');
  await assert.rejects(storage.deleteObject('character_image/u1/a.png'), (error) => error.code === 'STORAGE_KEY_OUTSIDE_PREFIX');
  await assert.rejects(storage.deleteObject('users/someone/else.png'), (error) => error.code === 'STORAGE_KEY_OUTSIDE_PREFIX');
  assert.equal(storage.selfTestFolder(), 'studio/selftest/');
  otherAppUntouched();
});

test('account deletion removes only that account\'s files in the shared bucket', async () => {
  const { agent, password } = await signupAgent(ctx.app);
  await makeInfographic(agent);
  await makeInfographic(agent, { withKey: false });
  const before = [...s3.state.objects.keys()].filter((key) => key.startsWith('studio/')).length;
  assert.ok(before >= 2);
  assert.equal((await agent.post('/api/settings/account/delete').send({ password })).status, 200);
  assert.equal([...s3.state.objects.keys()].filter((key) => key.startsWith('studio/')).length, before - 2);
  otherAppUntouched();
});
