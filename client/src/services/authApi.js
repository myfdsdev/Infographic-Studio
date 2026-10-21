import { api } from './api.js';

// Endpoints follow docs/api.md. They are implemented in the authentication phase.
export const authApi = {
  me: (options) => api.get('/auth/me', options),
  options: (options) => api.get('/auth/options', options),
  login: ({ email, password, remember = true }) => api.post('/auth/login', { email, password, remember }),
  signup: ({ name, email, password }) => api.post('/auth/signup', { name, email, password }),
  logout: () => api.post('/auth/logout'),
  stopActingAs: () => api.post('/auth/act-as/stop'),
  refresh: () => api.post('/auth/refresh'),
  forgotPassword: ({ email }) => api.post('/auth/forgot-password', { email }),
  resetPassword: ({ token, password }) => api.post('/auth/reset-password', { token, password }),
};
