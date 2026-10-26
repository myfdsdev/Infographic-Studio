import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { authApi } from '../services/authApi.js';
import { adminApi } from '../services/adminApi.js';
import { ApiError, isNotImplemented, isUnauthorized } from '../services/api.js';
import { PREVIEW_STORAGE_KEY } from '../utils/constants.js';

export const AuthContext = createContext(null);

// Session states:
//   loading          first /auth/me call in flight
//   authenticated    a real user session exists
//   unauthenticated  no session (redirect to login)
//   suspended        the account is suspended (redirect to login with a notice)
//   unavailable      the auth endpoints do not exist (backend phase missing)
//   error            the API or its database could not be reached, or it is
//                    rate limiting this address (code RATE_LIMITED)
//
// "Preview mode" only exists for the "unavailable" case: an explicit,
// user-triggered switch that lets the UI be browsed without a backend. It is
// never offered once the authentication API answers.
const PREVIEW_USER = Object.freeze({
  id: 'preview',
  name: 'Preview user',
  email: 'preview@infographic-studio.local',
  role: 'admin',
  preview: true,
});

function readPreviewFlag() {
  try {
    return window.sessionStorage.getItem(PREVIEW_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writePreviewFlag(enabled) {
  try {
    if (enabled) window.sessionStorage.setItem(PREVIEW_STORAGE_KEY, '1');
    else window.sessionStorage.removeItem(PREVIEW_STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

function isSuspended(error) {
  return error instanceof ApiError && error.code === 'ACCOUNT_SUSPENDED';
}

function isMaintenance(error) {
  return error instanceof ApiError && error.code === 'MAINTENANCE';
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // Set while an administrator views the app as this user ("Act as user"):
  // { admin: { id, name, email }, startedAt, expiresAt }. The server decides;
  // this only mirrors /auth/me so the app can show the banner.
  const [actingAs, setActingAs] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const [previewFlag, setPreviewFlag] = useState(readPreviewFlag);

  const refresh = useCallback(async () => {
    try {
      const result = await authApi.me({ timeoutMs: 15000 });
      setUser(result?.user || null);
      setActingAs(result?.actingAs || null);
      setStatus('authenticated');
      setError(null);
      return true;
    } catch (err) {
      setUser(null);
      setActingAs(null);
      setError(err);
      if (isUnauthorized(err)) setStatus('unauthenticated');
      else if (isSuspended(err)) setStatus('suspended');
      else if (isMaintenance(err)) setStatus('maintenance');
      else if (isNotImplemented(err)) setStatus('unavailable');
      else setStatus('error');
      return false;
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Once the real auth API answers, a stale preview flag is meaningless.
  useEffect(() => {
    if (previewFlag && status !== 'loading' && status !== 'unavailable') {
      writePreviewFlag(false);
      setPreviewFlag(false);
    }
  }, [previewFlag, status]);

  const login = useCallback(async (credentials) => {
    const result = await authApi.login(credentials);
    setUser(result?.user || null);
    setActingAs(null);
    setStatus('authenticated');
    setError(null);
    return result?.user;
  }, []);

  const signup = useCallback(async (payload) => {
    const result = await authApi.signup(payload);
    if (result?.user) {
      setUser(result.user);
      setActingAs(null);
      setStatus('authenticated');
      setError(null);
    }
    return result;
  }, []);

  /** Forget the session locally (after the server already ended it). */
  const markSignedOut = useCallback(() => {
    setUser(null);
    setActingAs(null);
    setStatus('unauthenticated');
    setError(null);
  }, []);

  const logout = useCallback(async () => {
    if (previewFlag) {
      writePreviewFlag(false);
      setPreviewFlag(false);
      return;
    }
    try {
      await authApi.logout();
    } catch {
      /* the session may already be gone; sign out locally either way */
    } finally {
      markSignedOut();
    }
  }, [previewFlag, markSignedOut]);

  const enablePreview = useCallback(() => {
    writePreviewFlag(true);
    setPreviewFlag(true);
  }, []);

  const disablePreview = useCallback(() => {
    writePreviewFlag(false);
    setPreviewFlag(false);
  }, []);

  /** Administrators: view the app as this user (read-only, time-limited). */
  const startActingAs = useCallback(async (userId) => {
    const result = await adminApi.actAs(userId);
    setUser(result?.user || null);
    setActingAs(result?.actingAs || null);
    return result;
  }, []);

  /** Leave "Act as user"; resolves to the server's answer ({ user, viewedUserId }). */
  const stopActingAs = useCallback(async () => {
    const result = await authApi.stopActingAs();
    setUser(result?.user || null);
    setActingAs(null);
    return result;
  }, []);

  // The server ends the view on its own after its time limit; re-read the
  // session then so the app switches back to the administrator.
  useEffect(() => {
    if (!actingAs?.expiresAt) return undefined;
    const wait = new Date(actingAs.expiresAt).getTime() - Date.now() + 1000;
    const timer = window.setTimeout(refresh, Math.max(wait, 1000));
    return () => window.clearTimeout(timer);
  }, [actingAs, refresh]);

  const updateUser = useCallback((patch) => {
    setUser((prev) => ({ ...(prev || {}), ...(patch || {}) }));
  }, []);

  const value = useMemo(() => {
    const isPreview = previewFlag && status === 'unavailable';
    const effectiveUser = isPreview ? PREVIEW_USER : user;
    return {
      user: effectiveUser,
      status,
      error,
      isLoading: status === 'loading',
      isAuthenticated: status === 'authenticated' || isPreview,
      isPreview,
      isAdmin: effectiveUser?.role === 'admin',
      actingAs: isPreview ? null : actingAs,
      startActingAs,
      stopActingAs,
      login,
      signup,
      logout,
      markSignedOut,
      refresh,
      enablePreview,
      disablePreview,
      updateUser,
      forgotPassword: authApi.forgotPassword,
      resetPassword: authApi.resetPassword,
    };
  }, [
    user,
    actingAs,
    status,
    error,
    previewFlag,
    startActingAs,
    stopActingAs,
    login,
    signup,
    logout,
    markSignedOut,
    refresh,
    enablePreview,
    disablePreview,
    updateUser,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
