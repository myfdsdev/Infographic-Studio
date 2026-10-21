import { api } from './api.js';

export const settingsApi = {
  /** Provider catalogue with the supported models and their options. */
  listProviders: (options) => api.get('/settings/providers', options),
  listCredentials: (options) => api.get('/settings/credentials', options),
  saveCredential: (provider, { apiKey }) =>
    api.put(`/settings/credentials/${encodeURIComponent(provider)}`, { apiKey }),
  deleteCredential: (provider) => api.delete(`/settings/credentials/${encodeURIComponent(provider)}`),
  verifyCredential: (provider) => api.post(`/settings/credentials/${encodeURIComponent(provider)}/verify`),
  updateAccount: (data) => api.patch('/settings/account', data),
  // currentPassword is left out when the account has no password yet.
  changePassword: ({ currentPassword, newPassword }) =>
    api.post('/settings/account/password', currentPassword ? { currentPassword, newPassword } : { newPassword }),
  getAccount: (options) => api.get('/settings/account', options),
  listSessions: (options) => api.get('/settings/sessions', options),
  revokeSession: (id) => api.delete(`/settings/sessions/${encodeURIComponent(id)}`),
  revokeOtherSessions: () => api.post('/settings/sessions/revoke-others'),
  // Accounts without a password (made with Google) confirm with their email instead.
  deleteAccount: ({ password, confirmEmail }) =>
    api.post('/settings/account/delete', password ? { password } : { confirmEmail }),
  disconnectGoogle: () => api.post('/settings/account/google/disconnect'),
};
