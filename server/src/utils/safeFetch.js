// Outbound HTTP for provider calls.
//
//   - Only hosts on the caller's allow-list are contacted.
//   - https only; plain http is allowed solely for loopback hosts outside
//     production (local mocks in tests).
//   - Redirects are refused (a redirect could carry the Authorization header
//     somewhere else).
//   - Hard timeout and response-size cap.
//   - Errors say whether the request could have reached the server, which the
//     job system needs to avoid duplicate paid submissions.
import { env } from '../config/env.js';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const MAX_BYTES = 2 * 1024 * 1024;

// Failures that happen before any byte of the request leaves this machine.
const NOT_SENT_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

export class FetchError extends Error {
  constructor(message, { code, maybeSent }) {
    super(message);
    this.name = 'FetchError';
    this.code = code;
    // true when the server may have received (and acted on) the request
    this.maybeSent = maybeSent;
  }
}

export function assertAllowedUrl(rawUrl, allowedHosts) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new FetchError('Invalid URL', { code: 'BAD_URL', maybeSent: false });
  }
  const host = url.hostname.toLowerCase();
  if (!allowedHosts.map((h) => h.toLowerCase()).includes(host)) {
    throw new FetchError(`Host ${host} is not allowed`, { code: 'HOST_NOT_ALLOWED', maybeSent: false });
  }
  const insecureOk = !env.isProduction && LOOPBACK.has(host);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && insecureOk)) {
    throw new FetchError('Only https URLs are allowed', { code: 'INSECURE_URL', maybeSent: false });
  }
  if (url.username || url.password) {
    throw new FetchError('Credentials in URLs are not allowed', { code: 'BAD_URL', maybeSent: false });
  }
  return url;
}

async function readLimited(response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new FetchError('Response too large', { code: 'RESPONSE_TOO_LARGE', maybeSent: true });
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}

/**
 * @returns {Promise<{status:number, text:string}>}
 */
export async function safeFetch(rawUrl, { method = 'GET', headers = {}, body, timeoutMs = 15000, allowedHosts = [] } = {}) {
  const url = assertAllowedUrl(rawUrl, allowedHosts);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const code = error?.cause?.code || error?.code || error?.name || 'FETCH_FAILED';
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new FetchError(`Request timed out after ${timeoutMs} ms`, { code: 'TIMEOUT', maybeSent: true });
    }
    throw new FetchError(`Network error (${code})`, { code, maybeSent: !NOT_SENT_CODES.has(code) });
  }
  let text;
  try {
    text = await readLimited(response);
  } catch (error) {
    if (error instanceof FetchError) throw error;
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    throw new FetchError(timedOut ? `Response timed out after ${timeoutMs} ms` : 'Response could not be read', {
      code: timedOut ? 'TIMEOUT' : 'READ_FAILED',
      maybeSent: true,
    });
  }
  return { status: response.status, text };
}

// ------------------------------------------------------------------------
// Downloading generated files from a provider CDN.
//
// Result URLs come from the provider, so they are treated as untrusted:
//   - https only (http only for loopback outside production: local mocks)
//   - the host must resolve to public addresses only (no 10/8, 192.168/16,
//     169.254/16, loopback, link-local, ULA, ...), checked on every redirect
//   - at most 3 redirects, no credentials ever sent, size and time capped
import dns from 'node:dns/promises';
import net from 'node:net';

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  const value = address.toLowerCase();
  if (value === '::' || value === '::1') return true;
  if (value.startsWith('::ffff:')) return isPrivateAddress(value.slice(7));
  return value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') ||
    value.startsWith('fea') || value.startsWith('feb') || value.startsWith('ff');
}

async function assertPublicHttpUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new FetchError('Invalid URL', { code: 'BAD_URL', maybeSent: false });
  }
  if (url.username || url.password) throw new FetchError('Credentials in URLs are not allowed', { code: 'BAD_URL', maybeSent: false });
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const loopbackOk = !env.isProduction && LOOPBACK.has(url.hostname.toLowerCase());
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopbackOk)) {
    throw new FetchError('Only https URLs are allowed', { code: 'INSECURE_URL', maybeSent: false });
  }
  if (loopbackOk) return url;
  let addresses;
  try {
    addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true, verbatim: true });
  } catch (error) {
    throw new FetchError(`Could not resolve ${host}`, { code: error.code || 'ENOTFOUND', maybeSent: false });
  }
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new FetchError(`Host ${host} is not a public address`, { code: 'HOST_NOT_ALLOWED', maybeSent: false });
  }
  return url;
}

/**
 * Download a public file into memory.
 * @returns {Promise<{ buffer: Buffer, contentType: string|null, finalUrl: string }>}
 */
export async function downloadPublicFile(rawUrl, { maxBytes, timeoutMs = 30000, maxRedirects = 3 } = {}) {
  const deadline = AbortSignal.timeout(timeoutMs);
  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const url = await assertPublicHttpUrl(current);
    let response;
    try {
      response = await fetch(url, { redirect: 'manual', signal: deadline, headers: { Accept: 'image/*,video/*,*/*;q=0.5' } });
    } catch (error) {
      const code = error?.cause?.code || error?.code || error?.name || 'FETCH_FAILED';
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new FetchError(`Download timed out after ${timeoutMs} ms`, { code: 'TIMEOUT', maybeSent: true });
      }
      throw new FetchError(`Download failed (${code})`, { code, maybeSent: true });
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => {});
      if (!location) throw new FetchError('Redirect without a location', { code: 'BAD_REDIRECT', maybeSent: true });
      current = new URL(location, url).toString();
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const error = new FetchError(`Download failed with HTTP ${response.status}`, { code: `HTTP_${response.status}`, maybeSent: true });
      error.status = response.status;
      throw error;
    }
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared && declared > maxBytes) {
      await response.body?.cancel().catch(() => {});
      throw new FetchError('File too large', { code: 'RESPONSE_TOO_LARGE', maybeSent: true });
    }
    const reader = response.body?.getReader();
    const chunks = [];
    let total = 0;
    if (reader) {
      for (;;) {
        let step;
        try {
          step = await reader.read();
        } catch (error) {
          const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
          throw new FetchError(timedOut ? `Download timed out after ${timeoutMs} ms` : 'Download interrupted', {
            code: timedOut ? 'TIMEOUT' : 'READ_FAILED',
            maybeSent: true,
          });
        }
        if (step.done) break;
        total += step.value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new FetchError('File too large', { code: 'RESPONSE_TOO_LARGE', maybeSent: true });
        }
        chunks.push(Buffer.from(step.value));
      }
    }
    return { buffer: Buffer.concat(chunks), contentType: response.headers.get('content-type'), finalUrl: url.toString() };
  }
  throw new FetchError('Too many redirects', { code: 'TOO_MANY_REDIRECTS', maybeSent: true });
}

/** Test hook. */
export const __private = { isPrivateAddress };
