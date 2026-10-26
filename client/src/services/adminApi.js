import { api } from './api.js';

const enc = encodeURIComponent;

export const adminApi = {
  stats: (options) => api.get('/admin/stats', options),
  system: (options) => api.get('/admin/system', options),
  failures: (query, options) => api.get('/admin/failures', { ...options, query }),
  opsLogs: (query, options) => api.get('/admin/ops-logs', { ...options, query }),

  listUsers: (query, options) => api.get('/admin/users', { ...options, query }),
  getUser: (id, options) => api.get(`/admin/users/${enc(id)}`, options),
  updateUser: (id, data) => api.patch(`/admin/users/${enc(id)}`, data),
  actAs: (id) => api.post(`/admin/users/${enc(id)}/act-as`),
  userCredits: (id, options) => api.get(`/admin/users/${enc(id)}/credits`, options),
  adjustCredits: (id, { amount, note }) => api.post(`/admin/users/${enc(id)}/credits`, note ? { amount, note } : { amount }),

  getSettings: (options) => api.get('/admin/settings', options),
  updateSettings: (data) => api.patch('/admin/settings', data),

  listJobs: (query, options) => api.get('/admin/jobs', { ...options, query }),
  retryJob: (id, { confirmDuplicateRisk = false } = {}) =>
    api.post(`/admin/jobs/${enc(id)}/retry`, confirmDuplicateRisk ? { confirmDuplicateRisk: true } : {}),
  cancelJob: (id) => api.post(`/admin/jobs/${enc(id)}/cancel`),

  listProviders: (options) => api.get('/admin/providers', options),
  setModel: (provider, model, enabled) => api.put(`/admin/providers/${enc(provider)}/models`, { model, enabled }),

  getPlatformKey: (options) => api.get('/admin/platform-key', options),
  savePlatformKey: (apiKey) => api.put('/admin/platform-key', { apiKey }),
  testPlatformKey: () => api.post('/admin/platform-key/test', {}),
  deletePlatformKey: () => api.delete('/admin/platform-key'),

  listBonusLinks: (options) => api.get('/admin/bonus-links', options),
  createBonusLink: (data) => api.post('/admin/bonus-links', data),
  getBonusLink: (id, options) => api.get(`/admin/bonus-links/${enc(id)}`, options),
  updateBonusLink: (id, data) => api.patch(`/admin/bonus-links/${enc(id)}`, data),

  listInfographics: (query, options) => api.get('/admin/infographics', { ...options, query }),
  mcpMonitor: (query, options) => api.get('/admin/mcp/monitor', { ...options, query }),
  listConnections: (query, options) => api.get('/admin/mcp/connections', { ...options, query }),
  revokeConnection: (id) => api.delete(`/admin/mcp/connections/${enc(id)}`),

  getBranding: (options) => api.get('/admin/branding', options),
  updateBranding: (data) => api.put('/admin/branding', data),
  uploadBrandingImage: (kind, file) => {
    const form = new FormData();
    form.append('file', file);
    return api.post(`/admin/branding/${enc(kind)}`, form, { timeoutMs: 60000 });
  },
  resetBrandingImage: (kind) => api.delete(`/admin/branding/${enc(kind)}`),
  resetBranding: () => api.post('/admin/branding/reset', {}),

  listAuditLogs: (query, options) => api.get('/admin/audit-logs', { ...options, query }),
};
