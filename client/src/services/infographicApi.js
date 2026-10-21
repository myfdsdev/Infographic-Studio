import { api, API_BASE_URL } from './api.js';
import { newIdempotencyKey } from './jobApi.js';

const enc = encodeURIComponent;

export { newIdempotencyKey };

export const infographicApi = {
  options: (options) => api.get('/infographics/options', options),
  list: (query, options) => api.get('/infographics', { ...options, query }),
  get: (id, options) => api.get(`/infographics/${enc(id)}`, options),
  /** Start a generation on the user's own Kie.ai key. */
  create: ({ topic, style, aspectRatio }, { idempotencyKey } = {}) =>
    api.post('/infographics', { topic, style, aspectRatio }, idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined),
  regenerate: (id, { idempotencyKey } = {}) =>
    api.post(`/infographics/${enc(id)}/regenerate`, {}, idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined),
  remove: (id) => api.delete(`/infographics/${enc(id)}`),
};

/** Same-origin image URL (served to the signed-in owner only). */
export function imageUrl(item) {
  return item?.image?.url ? `${API_BASE_URL}${item.image.url.replace(/^\/api/, '')}` : null;
}

export function downloadUrl(item) {
  const url = imageUrl(item);
  return url ? `${url}?download=1` : null;
}
