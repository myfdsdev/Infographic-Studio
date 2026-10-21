import { api } from './api.js';

/** A fresh key per user action, so a double click or a network retry cannot queue twice. */
export function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export const jobApi = {
  list: (query, options) => api.get('/jobs', { ...options, query }),
  get: (id, options) => api.get(`/jobs/${encodeURIComponent(id)}`, options),
  /** Queue a generation. Charges the user's own provider account. */
  create: (data, { idempotencyKey } = {}) =>
    api.post('/jobs', data, idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined),
  cancel: (id) => api.post(`/jobs/${encodeURIComponent(id)}/cancel`),
  retry: (id, { confirmDuplicateRisk = false } = {}) =>
    api.post(`/jobs/${encodeURIComponent(id)}/retry`, confirmDuplicateRisk ? { confirmDuplicateRisk: true } : {}),
};
