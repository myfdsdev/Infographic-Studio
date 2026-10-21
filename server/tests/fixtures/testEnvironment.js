// Shared set-up for tests that need a real MongoDB.
//
// Each test file runs in its own process (node --test), starts its own
// throwaway mongod via mongodb-memory-server, and points the app at it. The
// developer's server/.env (and any real database in it) is never used:
// MONGODB_URI is set here BEFORE the app's env module is imported, and dotenv
// never overrides variables that are already set.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import request from 'supertest';

export const STRONG_PASSWORD = 'Sunrise2026Pass';
export const OTHER_PASSWORD = 'Moonlight2026Pass';

export async function startTestEnvironment(overrides = {}) {
  const mongod = await MongoMemoryServer.create();
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infographic-test-storage-'));

  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    MONGODB_URI: mongod.getUri(),
    MONGODB_DB_NAME: 'ai_infographic_studio_test',
    SESSION_SECRET: 'test-only-session-secret-0123456789abcdef',
    ENCRYPTION_KEY: 'b'.repeat(64),
    EMAIL_PROVIDER: 'memory',
    CLIENT_URL: 'http://localhost:5173',
    SERVER_URL: 'http://localhost:5000',
    CORS_ORIGINS: '',
    COOKIE_SECURE: 'false',
    COOKIE_SAMESITE: 'lax',
    SIGNUP_ENABLED: 'true',
    STORAGE_DRIVER: 'local',
    STORAGE_LOCAL_DIR: storageDir,
    // Never let a developer's real bucket settings from server/.env reach a test.
    S3_ENDPOINT: '',
    S3_BUCKET: '',
    S3_ACCESS_KEY_ID: '',
    S3_SECRET_ACCESS_KEY: '',
    S3_PUBLIC_BASE_URL: '',
    STORAGE_KEY_PREFIX: '',
    STORAGE_ALLOW_SHARED_BUCKET: 'false',
    RATE_LIMIT_MAX: '100000',
    AUTH_RATE_LIMIT_MAX: '100000',
    LOGIN_EMAIL_RATE_LIMIT_MAX: '100000',
    JOB_CREATE_RATE_LIMIT_PER_MINUTE: '100000',
    // Tests drive the worker explicitly; tiny delays keep them fast.
    WORKER_ENABLED: 'false',
    KIE_API_BASE_URL: 'http://127.0.0.1:9',
    PUBLIC_WEBHOOK_BASE_URL: '',
    PROVIDER_SUBMIT_TIMEOUT_MS: '2000',
    PROVIDER_STATUS_TIMEOUT_MS: '2000',
    JOB_RETRY_BASE_MS: '1',
    JOB_POLL_MIN_MS: '1',
    JOB_POLL_MAX_MS: '5',
    JOB_MAX_ATTEMPTS: '3',
    JOB_USER_CONCURRENCY: '2',
    WORKER_CONCURRENCY: '4',
    ...overrides,
    // Uploads go to the same mock as the jobs API unless a test says otherwise.
    KIE_UPLOAD_BASE_URL: overrides.KIE_UPLOAD_BASE_URL || overrides.KIE_API_BASE_URL || 'http://127.0.0.1:9',
  });

  let env;
  let logger;
  let createApp;
  let connectDatabase;
  let disconnectDatabase;
  let models;
  let email;
  try {
    ({ env } = await import('../../src/config/env.js'));
    ({ logger } = await import('../../src/config/logger.js'));
    ({ createApp } = await import('../../src/app.js'));
    ({ connectDatabase, disconnectDatabase } = await import('../../src/config/database.js'));
    models = await import('../../src/models/index.js');
    email = await import('../../src/services/email.service.js');
  } catch (error) {
    // Never leave a mongod running (it would keep the test process alive).
    await mongod.stop().catch(() => {});
    fs.rmSync(storageDir, { recursive: true, force: true });
    throw error;
  }

  if (!env.MONGODB_URI.includes('127.0.0.1')) {
    throw new Error('Refusing to run tests against a non-local database');
  }

  await connectDatabase({ env, logger, retry: false });
  await models.ensureIndexes();
  const app = createApp({ env, logger });

  return {
    app,
    env,
    models,
    email,
    async stop() {
      await disconnectDatabase();
      await mongod.stop();
      fs.rmSync(storageDir, { recursive: true, force: true });
    },
  };
}

let counter = 0;
export function uniqueEmail(prefix = 'user') {
  counter += 1;
  return `${prefix}.${Date.now().toString(36)}.${counter}@example.test`;
}

/** Sign up a new account and return a cookie-carrying agent plus the user. */
export async function signupAgent(app, { name = 'Test User', email = uniqueEmail(), password = STRONG_PASSWORD } = {}) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/signup').send({ name, email, password });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, user: res.body.user, email, password };
}

export async function loginAgent(app, { email, password = STRONG_PASSWORD, remember = true }) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password, remember });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, user: res.body.user };
}

/**
 * Create an administrator for a test. Uses a direct database update because
 * the API intentionally offers no way for a non-admin to become one.
 */
export async function createAdminAgent(app, models, opts = {}) {
  const { email, password } = await signupAgent(app, { name: 'Admin User', ...opts });
  await models.User.updateOne({ email }, { role: 'admin' });
  return loginAgent(app, { email, password });
}

export function sessionCookieFrom(res) {
  const cookies = res.headers['set-cookie'] || [];
  return cookies.find((cookie) => cookie.startsWith('iv_session=')) || null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Run the worker until the job reaches a terminal status (or give up). */
export async function settleJob(worker, models, jobId, { maxRounds = 300 } = {}) {
  for (let round = 0; round < maxRounds; round += 1) {
    await worker.drain();
    const job = await models.GenerationJob.findById(jobId).lean();
    if (['completed', 'failed', 'cancelled'].includes(job.status)) return job;
    await sleep(3);
  }
  return models.GenerationJob.findById(jobId).lean();
}

export function tokenFromResetEmail(message) {
  const match = message.text.match(/reset-password\?token=([A-Za-z0-9_%-]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/** GET a binary response as a Buffer. */
export function getBytes(agent, url) {
  return agent
    .get(url)
    .buffer(true)
    .parse((res, callback) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });
}

/** Run jobs and the infographic save step until the infographic stops being active. */
export async function settleInfographic(worker, models, infographicId, { maxRounds = 300 } = {}) {
  for (let round = 0; round < maxRounds; round += 1) {
    await worker.drain();
    await worker.drainInfographics();
    const item = await models.Infographic.findById(infographicId).lean();
    if (!['queued', 'processing'].includes(item.status)) return item;
    await sleep(3);
  }
  return models.Infographic.findById(infographicId).lean();
}
