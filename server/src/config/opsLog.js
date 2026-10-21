// Operational log capture for the admin panel: a stream that receives the
// logger's JSON lines (already redacted by pino), keeps warnings and errors,
// redacts them again and writes them to MongoDB in small batches. Request
// logs of client errors (4xx) are skipped; server errors (5xx) are kept.
import os from 'node:os';
import { Writable } from 'node:stream';
import mongoose from 'mongoose';
import { OpsLog } from '../models/OpsLog.js';
import { redactDeep, redactText } from '../utils/redact.js';

const LEVELS = { 40: 'warn', 50: 'error', 60: 'fatal' };
const SKIP_FIELDS = new Set(['level', 'time', 'pid', 'hostname', 'msg', 'service', 'env', 'v', 'req', 'res', 'responseTime', 'err']);
const MAX_PENDING = 500;
const instance = `${os.hostname()}:${process.pid}`;

let pending = [];
let flushing = false;
let timer = null;

/** Turn one parsed log line into an ops entry, or null when it is not kept. */
export function toOpsEntry(line) {
  const level = LEVELS[line.level];
  if (!level) return null;
  const status = line.res?.statusCode;
  if (line.req && status && status < 500) return null;
  const context = {};
  for (const [key, value] of Object.entries(line)) {
    if (!SKIP_FIELDS.has(key)) context[key] = value;
  }
  if (line.err) context.error = { type: line.err.type, message: line.err.message, code: line.err.code };
  if (line.req) context.request = { method: line.req.method, url: line.req.url, status };
  return {
    level,
    message: redactText(line.msg || line.err?.message || '', 600),
    context: Object.keys(context).length ? redactDeep(context) : null,
    instance,
    at: new Date(line.time || Date.now()),
  };
}

async function flush() {
  if (flushing || pending.length === 0 || mongoose.connection.readyState !== 1) return;
  flushing = true;
  const batch = pending;
  pending = [];
  try {
    await OpsLog.insertMany(batch, { ordered: false });
  } catch {
    // Never log from here (it would loop); entries are dropped.
  } finally {
    flushing = false;
  }
}

export function createOpsLogStream({ flushMs = 2000 } = {}) {
  if (!timer) {
    timer = setInterval(() => {
      flush().catch(() => {});
    }, flushMs);
    timer.unref?.();
  }
  return new Writable({
    write(chunk, _encoding, callback) {
      try {
        for (const raw of String(chunk).split('\n')) {
          if (!raw.trim()) continue;
          const entry = toOpsEntry(JSON.parse(raw));
          if (entry) {
            pending.push(entry);
            if (pending.length > MAX_PENDING) pending.splice(0, pending.length - MAX_PENDING);
          }
        }
      } catch {
        // Not JSON: ignore.
      }
      callback();
    },
  });
}

/** Write captured entries now (tests, shutdown). */
export async function flushOpsLog() {
  await flush();
}
