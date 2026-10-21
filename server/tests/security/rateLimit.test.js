// Brute-force protection on login. Runs in its own process with tiny limits.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { startTestEnvironment, signupAgent, uniqueEmail, STRONG_PASSWORD } from '../fixtures/testEnvironment.js';

let ctx;
before(async () => {
  ctx = await startTestEnvironment({ AUTH_RATE_LIMIT_MAX: '6', LOGIN_EMAIL_RATE_LIMIT_MAX: '3' });
});
after(async () => {
  await ctx?.stop();
});

test('repeated wrong passwords for one account are throttled, even with the right password afterwards', async () => {
  const { email } = await signupAgent(ctx.app);
  for (let i = 0; i < 3; i += 1) {
    const res = await request(ctx.app).post('/api/auth/login').send({ email, password: `Wrong${i}12345` });
    assert.equal(res.status, 401);
  }
  const blocked = await request(ctx.app).post('/api/auth/login').send({ email, password: STRONG_PASSWORD });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error.code, 'RATE_LIMITED');
});

test('spraying many accounts from one address hits the per-IP limit', async () => {
  let throttled = false;
  for (let i = 0; i < 10 && !throttled; i += 1) {
    const res = await request(ctx.app).post('/api/auth/login').send({ email: uniqueEmail('spray'), password: 'Wrong123456' });
    if (res.status === 429) throttled = true;
    else assert.equal(res.status, 401);
  }
  assert.ok(throttled, 'per-IP limiter engaged');
});
