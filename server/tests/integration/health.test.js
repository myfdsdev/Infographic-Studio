// Health/readiness, error pipeline and environment validation. Runs WITHOUT a
// database on purpose: readiness must honestly report "not ready" then, and
// database-backed routes must fail fast with 503.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/ai_infographic_studio_unreachable';
process.env.SESSION_SECRET = 'test-only-session-secret-0123456789abcdef';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.EMAIL_PROVIDER = 'memory';
process.env.CORS_ORIGINS = '';
process.env.CLIENT_URL = 'http://localhost:5173';

const { loadEnv, databaseNameFromUri } = await import('../../src/config/env.js');
const { createLogger } = await import('../../src/config/logger.js');
const { createApp } = await import('../../src/app.js');

const env = loadEnv(process.env);
const app = createApp({ env, logger: createLogger(env) });

test('GET /api/health reports liveness', async () => {
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.service, 'infographic-studio-api');
  assert.equal(typeof res.body.uptimeSeconds, 'number');
});

test('GET /api/ready reports not_ready without a database and includes email status', async () => {
  const res = await request(app).get('/api/ready');
  assert.equal(res.status, 503);
  assert.equal(res.body.status, 'not_ready');
  assert.equal(res.body.checks.database.ok, false);
  assert.equal(res.body.checks.email.required, false);
  assert.equal(res.body.checks.email.provider, 'memory');
});

test('database-backed routes fail fast with 503 when the database is down', async () => {
  const res = await request(app).post('/api/auth/login').send({ email: 'a@example.test', password: 'whatever1' });
  assert.equal(res.status, 503);
  assert.equal(res.body.error.code, 'DATABASE_UNAVAILABLE');
});

test('GET /api lists the available endpoints', async () => {
  const res = await request(app).get('/api');
  assert.equal(res.status, 200);
  assert.ok(res.body.endpoints.includes('POST /api/auth/login'));
});

test('unknown routes return a JSON 404', async () => {
  const res = await request(app).get('/api/does-not-exist');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

test('malformed JSON bodies return a JSON 400', async () => {
  const res = await request(app).post('/api/does-not-exist').set('Content-Type', 'application/json').send('{"broken":');
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INVALID_JSON');
});

test('requests from a disallowed origin are rejected by CORS', async () => {
  const res = await request(app).get('/api/health').set('Origin', 'https://evil.example');
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'CORS_NOT_ALLOWED');
});

test('the environment loader rejects a malformed encryption key', () => {
  assert.throws(() => loadEnv({ ...process.env, ENCRYPTION_KEY: 'short' }), /ENCRYPTION_KEY/);
});

test('production refuses console email, memory email and insecure cookies', () => {
  const base = {
    ...process.env,
    NODE_ENV: 'production',
    STORAGE_DRIVER: 's3',
    S3_BUCKET: 'b',
    S3_ACCESS_KEY_ID: 'k',
    S3_SECRET_ACCESS_KEY: 's',
    S3_PUBLIC_BASE_URL: 'https://cdn.example.test',
    SERVER_URL: 'https://api.example.test',
  };
  assert.throws(() => loadEnv({ ...base, EMAIL_PROVIDER: 'console' }), /EMAIL_PROVIDER/);
  assert.throws(() => loadEnv({ ...base, EMAIL_PROVIDER: 'memory' }), /EMAIL_PROVIDER/);
  assert.throws(() => loadEnv({ ...base, EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.example.test', COOKIE_SECURE: 'false' }), /COOKIE_SECURE/);
  const ok = loadEnv({ ...base, EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.example.test', COOKIE_SECURE: '' });
  assert.equal(ok.cookieSecure, true);
  assert.equal(ok.mcpResourceUrl, 'https://api.example.test/mcp');
  // The OAuth issuer and MCP URL must be https in production, unless MCP is off.
  const smtp = { ...base, EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.example.test', COOKIE_SECURE: '' };
  assert.throws(() => loadEnv({ ...smtp, SERVER_URL: 'http://api.example.test' }), /SERVER_URL must use https/);
  assert.equal(loadEnv({ ...smtp, SERVER_URL: 'http://api.example.test', MCP_ENABLED: 'false' }).MCP_ENABLED, false);
});

test('a database name is taken from the URI, or defaults to ai_infographic_studio', () => {
  assert.equal(databaseNameFromUri('mongodb+srv://u:p@cluster.example.net/?retryWrites=true'), null);
  assert.equal(databaseNameFromUri('mongodb://127.0.0.1:27017/custom_db?x=1'), 'custom_db');
  const fromDefault = loadEnv({ ...process.env, MONGODB_URI: 'mongodb+srv://u:p@cluster.example.net', MONGODB_DB_NAME: '' });
  assert.equal(fromDefault.databaseName, 'ai_infographic_studio');
});
