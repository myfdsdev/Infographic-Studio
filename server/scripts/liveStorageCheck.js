#!/usr/bin/env node
// Opt-in LIVE check of the configured S3-compatible bucket (server/.env).
//
//   npm run test:live-storage        (from server/)
//
// 1. Can the bucket be reached with these keys? (read-only)
// 2. Is it dedicated to AI Infographic Studio? Its top level is listed; if it holds another
//    application's files the check STOPS here and writes nothing.
// 3. Writes one small PNG under the app's own self-test folder, reads it back through the
//    same storage service the app uses, checks anonymous access is refused,
//    deletes it and confirms it is gone.
//
// Credentials are never printed. Only the test object is ever written.
import crypto from 'node:crypto';

process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';

const { env } = await import('../src/config/env.js');
const storage = await import('../src/services/storage.service.js');
const { makePng } = await import('../tests/fixtures/images.js');

const report = { driver: env.STORAGE_DRIVER, bucket: env.S3_BUCKET || null, steps: [] };
const step = (name, ok, detail) => report.steps.push({ name, ok, ...(detail ? { detail } : {}) });

async function finish(code) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(code);
}

if (env.STORAGE_DRIVER !== 's3') {
  report.error = 'STORAGE_DRIVER is not s3 in server/.env; nothing to check.';
  await finish(2);
}

const reach = await storage.checkBucket({ timeoutMs: 10000 });
step('bucket reachable with these keys', reach.ok, reach.ok ? undefined : reach.reason);
if (!reach.ok) await finish(1);

const ownership = await storage.bucketOwnership({ force: true });
if (env.STORAGE_ALLOW_SHARED_BUCKET) {
  step('shared bucket allowed by STORAGE_ALLOW_SHARED_BUCKET; the app confined to its folder', true, env.STORAGE_KEY_PREFIX);
} else {
  step('bucket dedicated to AI Infographic Studio', ownership.dedicated, ownership.verified ? undefined : 'could not list the bucket to confirm');
}
if (!ownership.dedicated && !env.STORAGE_ALLOW_SHARED_BUCKET) {
  report.stopped = `The bucket holds ${ownership.foreignEntries} top-level entries from another application. Nothing was written. Use a bucket dedicated to AI Infographic Studio.`;
  await finish(3);
}

const key = `${storage.selfTestFolder()}${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(6).toString('hex')}.png`;
report.testObjectFolder = storage.selfTestFolder();
const bytes = makePng(64, 64);
try {
  await storage.putObject(key, bytes, { contentType: 'image/png' });
  step('write test object', true);

  const back = await storage.getObject(key);
  step('read back identical bytes', back.equals(bytes));

  const stream = await storage.openObjectStream(key);
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  step('stream read identical bytes', Buffer.concat(chunks).equals(bytes));

  step('exists check', await storage.objectExists(key));

  // Anonymous access must be refused (files are private).
  const endpoint = (env.S3_ENDPOINT || '').replace(/\/+$/, '');
  if (endpoint) {
    const anonymous = await fetch(`${endpoint}/${env.S3_BUCKET}/${key}`).catch(() => null);
    step('anonymous read through the S3 endpoint refused', !anonymous || anonymous.status !== 200, anonymous ? `HTTP ${anonymous.status}` : 'no response');
  }
  if (env.S3_PUBLIC_BASE_URL) {
    const publicRead = await fetch(`${env.S3_PUBLIC_BASE_URL.replace(/\/+$/, '')}/${key}`).catch(() => null);
    step('anonymous read through the public URL refused', !publicRead || publicRead.status !== 200, publicRead ? `HTTP ${publicRead.status}` : 'no response');
  }
} catch (error) {
  step('storage operation', false, error.message);
} finally {
  try {
    await storage.deleteObject(key);
    step('delete test object', !(await storage.objectExists(key)));
  } catch (error) {
    step('delete test object', false, error.message);
  }
}

await finish(report.steps.every((entry) => entry.ok) ? 0 : 1);
