import { api, ApiError } from './api.js';

export function getHealth(options) {
  return api.get('/health', options);
}

// Readiness returns 503 with a full report when a dependency is down. That is
// still useful data for the dashboard, so it is surfaced instead of thrown.
export async function getReadiness(options) {
  try {
    return await api.get('/ready', options);
  } catch (error) {
    if (error instanceof ApiError && error.status === 503 && error.body?.checks) {
      return error.body;
    }
    throw error;
  }
}
