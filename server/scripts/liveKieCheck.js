#!/usr/bin/env node
// Opt-in LIVE check against the real Kie.ai API. Spends real credits.
//
//   npm run test:live-kie        (from server/)
//
// Reads ONLY server/.env.live-test (git-ignored by the ".env.*" rule):
//   KIE_LIVE_TEST_API_KEY=...        a designated test key (never your main key)
//   KIE_LIVE_TEST_MAX_CREDITS=20     spending limit for this run
//   KIE_LIVE_TEST_RATIO=3:4          optional: 1:1, 3:4 or 9:16 (default 3:4)
//
// What it does:
//   1. reads the balance (free)
//   2. generates ONE infographic exactly as the app does (the app's prompt
//      builder, z-image, PNG, the chosen ratio)
//   3. downloads the result through the same safe downloader the app uses
//      and checks it is a real image of the expected shape
//   4. writes the image to server/storage/live-check-<time>.png for a look
//
// Kie.ai does not publish per-task prices in its API docs, so the task
// cannot be priced in advance: the spend is measured from the balance and
// reported. For a hard cap use a separate Kie.ai account loaded with only
// the test budget.
//
// The key is never printed. Nothing is written to the database.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(serverRoot, '.env.live-test');
if (!fs.existsSync(configPath)) {
  console.error(`Missing ${configPath}. Create it with KIE_LIVE_TEST_API_KEY and KIE_LIVE_TEST_MAX_CREDITS (see the header of this script).`);
  process.exit(2);
}
const live = dotenv.parse(fs.readFileSync(configPath));
const apiKey = (live.KIE_LIVE_TEST_API_KEY || '').trim();
const maxCredits = Number(live.KIE_LIVE_TEST_MAX_CREDITS);
const ratio = ['1:1', '3:4', '9:16'].includes(live.KIE_LIVE_TEST_RATIO) ? live.KIE_LIVE_TEST_RATIO : '3:4';
if (!apiKey || !Number.isFinite(maxCredits) || maxCredits <= 0) {
  console.error('KIE_LIVE_TEST_API_KEY and a positive KIE_LIVE_TEST_MAX_CREDITS are both required in .env.live-test.');
  process.exit(2);
}

// The provider code reads the app config; give it a harmless one so nothing
// here can touch the real database or mail settings.
Object.assign(process.env, {
  NODE_ENV: 'development',
  LOG_LEVEL: 'silent',
  MONGODB_URI: 'mongodb://127.0.0.1:1/live-check-unused',
  SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
  ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
  EMAIL_PROVIDER: 'console',
  KIE_API_BASE_URL: 'https://api.kie.ai',
  KIE_UPLOAD_BASE_URL: 'https://kieai.redpandaai.co',
  PROVIDER_SUBMIT_TIMEOUT_MS: '45000',
});

const client = await import('../src/providers/kie/client.js');
const { normalizeTask } = await import('../src/providers/kie/status.js');
const { findModel } = await import('../src/providers/kie/capabilities.js');
const { buildInfographicPrompt } = await import('../src/services/infographicPrompt.js');
const { INFOGRAPHIC_MODEL } = await import('../src/services/infographic.service.js');
const { downloadPublicFile } = await import('../src/utils/safeFetch.js');
const { inspectImage } = await import('../src/utils/imageInspect.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = { startedAt: new Date().toISOString(), limit: maxCredits, tasks: [], notes: [] };

async function balance() {
  return client.getCredits(apiKey);
}

async function runTask(label, params) {
  const model = findModel(INFOGRAPHIC_MODEL);
  const input = model.build(params);
  let taskId;
  try {
    taskId = await client.createTask(apiKey, { model: model.id, input });
  } catch (error) {
    if (error.uncertain) {
      report.notes.push(`${label}: the submission outcome is unknown (${error.message}). It was NOT resent. Check your Kie.ai logs.`);
      return null;
    }
    throw error;
  }
  const started = Date.now();
  for (;;) {
    await sleep(5000);
    const task = normalizeTask(await client.getTask(apiKey, taskId));
    if (task.state === 'succeeded' || task.state === 'failed') {
      const entry = {
        label,
        model: model.id,
        taskId,
        state: task.state,
        error: task.error || null,
        creditsConsumed: task.creditsConsumed,
        seconds: Math.round((Date.now() - started) / 1000),
        resultHost: task.resultUrls?.[0] ? new URL(task.resultUrls[0]).host : null,
      };
      report.tasks.push(entry);
      return { ...entry, resultUrl: task.resultUrls?.[0] || null };
    }
    if (Date.now() - started > 6 * 60 * 1000) {
      report.notes.push(`${label}: no result after 6 minutes (task ${taskId}). It may still finish and be charged.`);
      return null;
    }
  }
}

try {
  const before = await balance();
  report.balanceBefore = before;
  if (before < 1) throw new Error('The test account has no credits.');

  const prompt = buildInfographicPrompt({
    topic: '5 benefits of AI automation for small businesses: saves time, fewer errors, faster replies, better use of data, lower costs.',
    style: 'corporate',
    aspectRatio: ratio,
  });
  const result = await runTask(`infographic (${ratio}, corporate)`, { prompt, aspectRatio: ratio });
  const afterTask = await balance();
  report.spent = Math.max(0, before - afterTask);
  if (report.spent > maxCredits) report.notes.push(`The task cost ${report.spent} credits, more than the limit of ${maxCredits}.`);

  if (result?.state === 'succeeded' && result.resultUrl) {
    const file = await downloadPublicFile(result.resultUrl, { maxBytes: 30 * 1024 * 1024 });
    const image = inspectImage(file.buffer, { minSide: 64 });
    const [w, h] = ratio.split(':').map(Number);
    const expected = w / h;
    const actual = image.width / image.height;
    report.download = {
      ok: true,
      mimeType: image.mimeType,
      width: image.width,
      height: image.height,
      ratioMatches: Math.abs(actual - expected) / expected < 0.03,
    };
    const outDir = path.join(serverRoot, 'storage');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `live-check-${Date.now()}.${image.ext}`);
    fs.writeFileSync(outFile, image.buffer);
    report.savedTo = outFile;
  }

  const after = await balance();
  report.balanceAfter = after;
  report.totalSpent = Math.max(0, before - after);
  report.withinLimit = report.totalSpent <= maxCredits;
} catch (error) {
  report.error = error.message;
}

report.finishedAt = new Date().toISOString();
console.log(JSON.stringify(report, null, 2));
process.exit(report.error ? 1 : 0);
