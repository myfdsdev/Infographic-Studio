// The S3 storage driver through the real AWS SDK against a local S3-compatible
// mock: saved infographics, owner-only reads, deletion, readiness, the
// dedicated-bucket guard and outages. No real bucket is touched.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { startMockS3 } from '../fixtures/mockS3.js';
import { startMockKie } from '../fixtures/mockKie.js';
import { makePng } from '../fixtures/images.js';
import { startTestEnvironment, signupAgent, settleInfographic, getBytes } from '../fixtures/testEnvironment.js';

const KEY = 'kie_test_key_S3S3_0123456789abcdef';

let s3;
let mock;
let ctx;
let worker;
let storage;
before(async () => {
  s3 = await startMockS3({ bucket: 'infographic-test' });
  mock = await startMockKie();
  ctx = await startTestEnvironment({
    KIE_API_BASE_URL: mock.url,
    STORAGE_DRIVER: 's3',
    S3_ENDPOINT: s3.url,
    S3_REGION: 'auto',
    S3_BUCKET: 'infographic-test',
    S3_ACCESS_KEY_ID: 'test-access-key-0001',
    S3_SECRET_ACCESS_KEY: 'test-secret-key-0123456789abcdef0123456789',
  });
  storage = await import('../../src/services/storage.service.js');
  const { createWorker } = await import('../../src/jobs/worker.js');
  const { logger } = await import('../../src/config/logger.js');
  worker = createWorker({ env: ctx.env, logger, workerId: 's3-worker' });
});
after(async () => {
  await ctx?.stop();
  await mock?.stop();
  await s3?.stop();
});
beforeEach(() => {
  s3.state.down = false;
  for (const key of [...s3.state.objects.keys()]) if (!key.startsWith('users/')) s3.state.objects.delete(key);
  storage.__resetStorageState();
  mock.reset();
  mock.state.validKeys = new Set([KEY]);
});

test('readiness reports a reachable, dedicated bucket', async () => {
  const res = await request(ctx.app).get('/api/ready');
  assert.equal(res.status, 200);
  assert.equal(res.body.checks.storage.driver, 's3');
  assert.equal(res.body.checks.storage.reachable, true);
  assert.equal(res.body.checks.storage.dedicated, true);
  assert.equal(res.body.checks.storage.ok, true);
});

async function makeInfographic() {
  const account = await signupAgent(ctx.app);
  await account.agent.put('/api/settings/credentials/kie').send({ apiKey: KEY });
  const created = await account.agent.post('/api/infographics').send({ topic: 'Three ways to keep files safe in the cloud.', style: 'minimal', aspectRatio: '1:1' });
  assert.equal(created.status, 202, JSON.stringify(created.body));
  const item = await settleInfographic(worker, ctx.models, created.body.infographic.id);
  return { ...account, item };
}

test('a finished infographic is stored in the bucket privately and read back only by its owner', async () => {
  const { agent, item } = await makeInfographic();
  assert.equal(item.status, 'completed');
  const row = await ctx.models.Asset.findById(item.image.assetId).lean();
  assert.equal(row.storageDriver, 's3');
  const stored = s3.state.objects.get(row.storageKey);
  assert.ok(stored, 'object written to the bucket');
  assert.match(row.storageKey, /^users\/[a-f0-9]{24}\/infographic-image\//);
  assert.equal(stored.contentType, 'image/png');
  assert.match(stored.cacheControl, /private/);
  assert.equal(stored.acl, null, 'no public ACL is ever requested');
  assert.deepEqual(stored.body, mock.resultPng);
  assert.equal(s3.state.unsigned, 0, 'every request is signed');

  const url = `/api/infographics/${item._id}/image`;
  const bytes = await getBytes(agent, url);
  assert.equal(bytes.status, 200);
  assert.deepEqual(bytes.body, stored.body);
  const other = await signupAgent(ctx.app);
  assert.equal((await getBytes(other.agent, url)).status, 404);
});

test('deleting an infographic deletes its object from the bucket', async () => {
  const { agent, user, item } = await makeInfographic();
  assert.equal([...s3.state.objects.keys()].filter((key) => key.startsWith(`users/${user.id}/`)).length, 1);
  assert.equal((await agent.delete(`/api/infographics/${item._id}`)).status, 200);
  assert.equal([...s3.state.objects.keys()].filter((key) => key.startsWith(`users/${user.id}/`)).length, 0, 'objects deleted from the bucket');
});

test("a bucket holding another application's files is never written to", async () => {
  s3.state.objects.set('character_image/other-app-user/photo.png', {
    body: Buffer.from('another app'),
    contentType: 'image/png',
    etag: 'x',
    modified: new Date(),
  });
  const before = s3.state.calls.put;
  const { user } = await signupAgent(ctx.app);
  const assets = await import('../../src/services/asset.service.js');
  await assert.rejects(
    assets.storeGeneratedImage(user.id, { buffer: makePng(300, 300), purpose: 'infographic_image' }),
    (error) => error.code === 'STORAGE_NOT_DEDICATED' && !error.message.includes('character_image'),
  );
  assert.equal(s3.state.calls.put, before, 'nothing was written');
  assert.equal(s3.state.objects.get('character_image/other-app-user/photo.png').body.toString(), 'another app', "the other app's file is untouched");

  const ready = await request(ctx.app).get('/api/ready');
  assert.equal(ready.status, 503);
  assert.equal(ready.body.checks.storage.reachable, true);
  assert.equal(ready.body.checks.storage.dedicated, false);
  assert.ok(!JSON.stringify(ready.body).includes('character_image'));
});

test('a storage outage gives a clear 503 without leaking details', async () => {
  const { agent, user, item } = await makeInfographic();
  s3.state.down = true;
  const assets = await import('../../src/services/asset.service.js');
  await assert.rejects(
    assets.storeGeneratedImage(user.id, { buffer: makePng(300, 300), purpose: 'infographic_image' }),
    (error) => error.code === 'STORAGE_UNAVAILABLE' && !error.message.includes('infographic-test'),
  );
  const read = await getBytes(agent, `/api/infographics/${item._id}/image`);
  assert.equal(read.status, 503);
  assert.ok(!read.body.toString().includes('infographic-test'));
  const ready = await request(ctx.app).get('/api/ready');
  assert.equal(ready.status, 503);
  assert.equal(ready.body.checks.storage.reachable, false);
});
