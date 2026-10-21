// Kie.ai HTTP client (docs.kie.ai).
//
//   POST /api/v1/jobs/createTask      start a task, returns data.taskId
//   GET  /api/v1/jobs/recordInfo      task status and results
//   GET  /api/v1/chat/credit          remaining credits (no generation, no charge
//                                     documented) - used to test a key
//
// Kie.ai answers HTTP 200 even for errors; the real status is the body `code`.
// Every failure becomes a ProviderError that says whether it is retryable and
// whether the provider MAY have created a task anyway ("uncertain"), which the
// job system uses to avoid paying twice.
//
// Adapted from Cinema Studio's create/check functions, with one deliberate
// change: Cinema Studio resent createTask on 500/502/503, which can create
// (and bill) a second task. Here those outcomes are reported as uncertain.
import { env } from '../../config/env.js';
import { safeFetch, FetchError } from '../../utils/safeFetch.js';

export class ProviderError extends Error {
  /**
   * @param {string} message
   * @param {object} opts
   * @param {'auth'|'insufficient_credits'|'validation'|'not_found'|'rate_limited'|'maintenance'|'server'|'feature_disabled'|'generation_failed'|'timeout'|'network'|'bad_response'} opts.kind
   * @param {boolean} opts.retryable  safe to try again later
   * @param {boolean} opts.uncertain  the provider may have accepted the request
   */
  constructor(message, { kind, retryable = false, uncertain = false, providerCode = null } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.retryable = retryable;
    this.uncertain = uncertain;
    this.providerCode = providerCode;
  }
}

function baseUrl() {
  return env.KIE_API_BASE_URL.replace(/\/+$/, '');
}

function allowedHosts() {
  return [new URL(baseUrl()).hostname];
}

// Body `code` -> classification. `submit` = true for createTask, where a
// server-side error leaves the outcome unknown.
function classify(code, msg, { submit }) {
  const message = msg || `Kie.ai returned code ${code}`;
  switch (Number(code)) {
    case 401:
      return new ProviderError('Kie.ai rejected the API key', { kind: 'auth', providerCode: code });
    case 402:
      return new ProviderError('Your Kie.ai account does not have enough credits', { kind: 'insufficient_credits', providerCode: code });
    case 404:
      return new ProviderError('Kie.ai endpoint or task not found', { kind: 'not_found', providerCode: code });
    case 408:
      return new ProviderError('Kie.ai returned no result for over 10 minutes', { kind: 'timeout', retryable: !submit, uncertain: submit, providerCode: code });
    case 422:
      return new ProviderError(`Kie.ai rejected the request: ${message}`, { kind: 'validation', providerCode: code });
    case 429:
      return new ProviderError('Kie.ai rate limit reached', { kind: 'rate_limited', retryable: true, providerCode: code });
    case 455:
      return new ProviderError('Kie.ai is under maintenance', { kind: 'maintenance', retryable: true, providerCode: code });
    case 501:
      return new ProviderError(`Generation failed: ${message}`, { kind: 'generation_failed', providerCode: code });
    case 505:
      return new ProviderError('This model is currently disabled on Kie.ai', { kind: 'feature_disabled', providerCode: code });
    default:
      return new ProviderError(`Kie.ai server error: ${message}`, {
        kind: 'server',
        retryable: !submit,
        uncertain: submit,
        providerCode: code,
      });
  }
}

async function call(apiKey, method, path, { body, timeoutMs, submit = false } = {}) {
  if (!apiKey) throw new ProviderError('No API key', { kind: 'auth' });
  let response;
  try {
    response = await safeFetch(`${baseUrl()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      timeoutMs,
      allowedHosts: allowedHosts(),
    });
  } catch (error) {
    if (error instanceof FetchError) {
      const maybeSent = Boolean(error.maybeSent);
      throw new ProviderError(`Could not reach Kie.ai: ${error.message}`, {
        kind: error.code === 'TIMEOUT' ? 'timeout' : 'network',
        retryable: !submit || !maybeSent,
        uncertain: submit && maybeSent,
      });
    }
    throw error;
  }

  let parsed = null;
  try {
    parsed = response.text ? JSON.parse(response.text) : null;
  } catch {
    parsed = null;
  }

  if (!parsed || typeof parsed !== 'object') {
    // A gateway error page instead of JSON. For a submission a 5xx means the
    // request may have been processed; anything else means it was not.
    const serverSide = response.status >= 500;
    if (response.status === 401) throw classify(401, null, { submit });
    throw new ProviderError(`Unexpected response from Kie.ai (HTTP ${response.status})`, {
      kind: serverSide ? 'server' : 'bad_response',
      retryable: !(submit && serverSide),
      uncertain: submit && serverSide,
    });
  }

  const code = parsed.code ?? response.status;
  if (Number(code) !== 200) throw classify(code, parsed.msg, { submit });
  return parsed.data;
}

/** Remaining credits. Used to test a key without starting a generation. */
export async function getCredits(apiKey) {
  const data = await call(apiKey, 'GET', '/api/v1/chat/credit', { timeoutMs: env.PROVIDER_STATUS_TIMEOUT_MS });
  const balance = typeof data === 'number' ? data : Number.parseFloat(data);
  if (!Number.isFinite(balance)) {
    throw new ProviderError('Kie.ai returned an unreadable credit balance', { kind: 'bad_response', retryable: true });
  }
  return balance;
}

/** Start a task. Returns the provider task id. */
export async function createTask(apiKey, { model, input, callBackUrl }) {
  const data = await call(apiKey, 'POST', '/api/v1/jobs/createTask', {
    body: { model, input, ...(callBackUrl ? { callBackUrl } : {}) },
    timeoutMs: env.PROVIDER_SUBMIT_TIMEOUT_MS,
    submit: true,
  });
  const taskId = data?.taskId;
  if (!taskId || typeof taskId !== 'string') {
    // The provider said 200 but gave no id: a task may exist that we cannot see.
    throw new ProviderError('Kie.ai accepted the request but returned no task id', {
      kind: 'bad_response',
      uncertain: true,
    });
  }
  return taskId;
}

/** Raw task details (see status.js for normalisation). */
export async function getTask(apiKey, taskId) {
  return call(apiKey, 'GET', `/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
    timeoutMs: env.PROVIDER_STATUS_TIMEOUT_MS,
  });
}

// ------------------------------------------------------------------------
// File Upload API (docs.kie.ai/file-upload-api): free, files deleted after
// 24 hours. Used to hand stored reference images (faces, approved characters)
// to a model without making them public anywhere else.

function uploadBaseUrl() {
  return env.KIE_UPLOAD_BASE_URL.replace(/\/+$/, '');
}

const UPLOAD_PATH = 'infographic-studio-references';

/**
 * Upload one file. Returns { url, expiresAt }.
 * Retrying is safe: an upload creates no task and costs nothing.
 */
export async function uploadFile(apiKey, { buffer, mimeType, fileName }) {
  if (!apiKey) throw new ProviderError('No API key', { kind: 'auth' });
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType }), fileName);
  form.append('uploadPath', UPLOAD_PATH);
  form.append('fileName', fileName);
  let response;
  try {
    response = await safeFetch(`${uploadBaseUrl()}/api/file-stream-upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      body: form,
      timeoutMs: env.PROVIDER_SUBMIT_TIMEOUT_MS,
      allowedHosts: [new URL(uploadBaseUrl()).hostname],
    });
  } catch (error) {
    if (error instanceof FetchError) {
      throw new ProviderError(`Could not upload the reference image to Kie.ai: ${error.message}`, {
        kind: error.code === 'TIMEOUT' ? 'timeout' : 'network',
        retryable: true,
      });
    }
    throw error;
  }
  let parsed = null;
  try {
    parsed = response.text ? JSON.parse(response.text) : null;
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new ProviderError(`Unexpected upload response from Kie.ai (HTTP ${response.status})`, {
      kind: response.status >= 500 ? 'server' : 'bad_response',
      retryable: true,
    });
  }
  const code = Number(parsed.code ?? response.status);
  if (code !== 200 || parsed.success === false) throw classify(code, parsed.msg, { submit: false });
  const url = parsed.data?.downloadUrl;
  const insecureOk = !env.isProduction && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(String(url));
  if (typeof url !== 'string' || !(url.startsWith('https://') || insecureOk)) {
    throw new ProviderError('Kie.ai did not return a usable file URL for the upload', { kind: 'bad_response', retryable: true });
  }
  const uploadedAt = Date.parse(parsed.data?.uploadedAt) || Date.now();
  return { url, expiresAt: new Date(uploadedAt + 24 * 60 * 60 * 1000) };
}

/**
 * Ask Kie.ai for a fresh download link for a generated file (valid 20 minutes
 * per the docs). Used when a result URL cannot be fetched directly.
 */
export async function getDownloadUrl(apiKey, fileUrl) {
  const data = await call(apiKey, 'POST', '/api/v1/common/download-url', {
    body: { url: fileUrl },
    timeoutMs: env.PROVIDER_STATUS_TIMEOUT_MS,
  });
  if (typeof data !== 'string' || !data) {
    throw new ProviderError('Kie.ai did not return a download link', { kind: 'bad_response', retryable: true });
  }
  return data;
}
