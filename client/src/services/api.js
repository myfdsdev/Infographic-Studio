// Thin fetch wrapper used by every client-side service. All requests go to the
// AI Infographic Studio Express backend; nothing in the client talks to a provider or any
// third-party API directly.
import { API_BASE_URL } from '../utils/constants.js';

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'UNKNOWN', details = null, body = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.body = body;
  }
}

/**
 * True when the backend answered 404 because the ROUTE does not exist yet
 * (the server's not-found handler prefixes those messages with "Route ").
 * A 404 for a missing record has a different message and is not matched.
 */
export function isNotImplemented(error) {
  return (
    error instanceof ApiError &&
    error.status === 404 &&
    error.code === 'NOT_FOUND' &&
    /^Route\s/i.test(error.message || '')
  );
}

export function isUnauthorized(error) {
  return error instanceof ApiError && error.status === 401;
}

export function isNetworkError(error) {
  return error instanceof ApiError && ['NETWORK_ERROR', 'TIMEOUT', 'API_UNREACHABLE'].includes(error.code);
}

// A successful answer that is not JSON (usually a static host returning its
// index.html for /api) means the request never reached the app's API.
export const API_UNREACHABLE_MESSAGE =
  'Could not reach the API: the address answered with a web page instead of data. '
  + 'Check that this deployment points to the API (VITE_API_BASE_URL, or the API serving the app with SERVE_CLIENT).';

export function errorMessage(error, fallback = 'Something went wrong') {
  if (!error) return fallback;
  if (isNotImplemented(error)) return 'This backend endpoint is not implemented yet.';
  return error.message || fallback;
}

async function request(path, { method = 'GET', body, headers = {}, timeoutMs = 20000, signal, query } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });

  let url = `${API_BASE_URL}${path}`;
  if (query && typeof query === 'object') {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      params.set(key, String(value));
    }
    const qs = params.toString();
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  }

  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

  try {
    const response = await fetch(url, {
      method,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined && !isFormData ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    let data = null;
    let isJson = true;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      isJson = false;
      data = { raw: text };
    }

    if (!response.ok) {
      const err = data?.error || {};
      throw new ApiError(err.message || `Request failed with status ${response.status}`, {
        status: response.status,
        code: err.code || 'HTTP_ERROR',
        details: err.details ?? null,
        body: data,
      });
    }
    if (!isJson) {
      throw new ApiError(API_UNREACHABLE_MESSAGE, { status: response.status, code: 'API_UNREACHABLE' });
    }
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error?.name === 'AbortError') {
      throw new ApiError('The request timed out', { code: 'TIMEOUT' });
    }
    throw new ApiError(error?.message || 'Network error', { code: 'NETWORK_ERROR' });
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
};

export { API_BASE_URL };
