import { api } from './api.js';

const enc = encodeURIComponent;

export const mcpApi = {
  info: (options) => api.get('/mcp/info', options),
  listConnections: (options) => api.get('/mcp/connections', options),
  revokeConnection: (id) => api.delete(`/mcp/connections/${enc(id)}`),
  activity: (options) => api.get('/mcp/activity', options),

  // Consent page (the OAuth request an AI app started)
  getConsent: (uid, options) => api.get(`/oauth/interactions/${enc(uid)}`, options),
  approveConsent: (uid, scopes) => api.post(`/oauth/interactions/${enc(uid)}/approve`, { scopes }),
  denyConsent: (uid) => api.post(`/oauth/interactions/${enc(uid)}/deny`, {}),
};
