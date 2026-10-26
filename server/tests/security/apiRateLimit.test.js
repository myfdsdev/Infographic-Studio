// General /api limiter. Runs in its own process with a tiny limit.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { startTestEnvironment } from '../fixtures/testEnvironment.js';

let ctx;
before(async () => {
  ctx = await startTestEnvironment({ RATE_LIMIT_MAX: '3' });
});
after(async () => {
  await ctx?.stop();
});

test('image reads are not counted, other /api requests are', async () => {
  // Far more image reads than the limit: none of them is throttled.
  for (let i = 0; i < 8; i += 1) {
    const logo = await request(ctx.app).get('/api/branding/logo');
    assert.notEqual(logo.status, 429);
    const image = await request(ctx.app).get('/api/infographics/000000000000000000000000/image');
    assert.notEqual(image.status, 429);
  }

  for (let i = 0; i < 3; i += 1) {
    const res = await request(ctx.app).get('/api/branding');
    assert.notEqual(res.status, 429);
  }
  const blocked = await request(ctx.app).get('/api/branding');
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error.code, 'RATE_LIMITED');
});
