import { useEffect, useState } from 'react';
import { authApi } from '../../services/authApi.js';
import { API_BASE_URL } from '../../utils/constants.js';

// What the server's ?google=<code> answers mean (see server googleAuth.service).
export const GOOGLE_MESSAGES = Object.freeze({
  connected: 'Google is connected. You can now sign in with Google too.',
  cancelled: 'Google sign-in was cancelled.',
  expired: 'The Google sign-in took too long or was finished in another browser. Please try again.',
  failed: 'Google sign-in could not be completed. Please try again.',
  unverified_email: 'Your Google account email is not verified by Google, so it cannot be used here.',
  email_in_use:
    'An account with this email already exists. Sign in with your password, then connect Google in Account settings.',
  signup_disabled: 'New sign-ups are closed. Ask the administrator for access.',
  suspended: 'This account is suspended. Contact the administrator if you think this is a mistake.',
  maintenance: 'AI Infographic Studio is under maintenance. Please try again later.',
  unavailable: 'Sign in with Google is not set up on this server.',
  already_linked: 'This Google account is already connected to another account.',
  not_signed_in: 'Your session changed while connecting Google. Sign in again and retry.',
  not_allowed: 'Google cannot be connected while viewing the app as another user.',
});

export function googleMessage(code) {
  if (!code) return null;
  return GOOGLE_MESSAGES[code] || GOOGLE_MESSAGES.failed;
}

/** Whether this server offers Sign in with Google (null while asking). */
export function useGoogleAvailable() {
  const [available, setAvailable] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    authApi
      .options({ signal: controller.signal })
      .then((result) => setAvailable(Boolean(result?.google)))
      .catch(() => setAvailable(false));
    return () => controller.abort();
  }, []);
  return available;
}

export function googleStartUrl(returnTo) {
  const path = typeof returnTo === 'string' && returnTo.startsWith('/') && returnTo !== '/' ? returnTo : '';
  return `${API_BASE_URL}/auth/google/start${path ? `?returnTo=${encodeURIComponent(path)}` : ''}`;
}

export const GOOGLE_CONNECT_URL = `${API_BASE_URL}/auth/google/connect`;

/** Google's multicolour "G" mark, as Google's sign-in branding asks for. */
export function GoogleMark({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** A plain link: the browser goes to the API, then to Google, then back. */
export function GoogleButton({ href, children = 'Continue with Google', className = '' }) {
  return (
    <a className={`btn iv-google-btn ${className}`.trim()} href={href}>
      <GoogleMark />
      <span>{children}</span>
    </a>
  );
}
