import * as authService from '../services/auth.service.js';
import * as googleAuth from '../services/googleAuth.service.js';
import { stopActingAs as endActingAs, toActingAsDto } from '../services/actAs.service.js';
import { getPlatformSettings } from '../services/platformSettings.service.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError } from '../utils/errors.js';

export async function signup(req, res) {
  const { user, token, session, bonus } = await authService.signup(req.validated.body, req);
  authService.setSessionCookie(res, token, session);
  res.status(201).json({ user: authService.publicUser(user), bonus: bonus || null });
}

export async function login(req, res) {
  const { user, token, session } = await authService.login(req.validated.body, req);
  authService.setSessionCookie(res, token, session);
  res.json({ user: authService.publicUser(user) });
}

export async function logout(req, res) {
  // While acting as a user, it is the administrator who signs out.
  if (req.impersonator) await endActingAs(req.impersonator, req.authSession, req.user, req, 'Ended: signed out');
  await authService.logout(req.impersonator || req.user, req.authSession, req);
  authService.clearSessionCookie(res);
  res.json({ ok: true });
}

export async function me(req, res) {
  res.json({ user: authService.publicUser(req.user), actingAs: toActingAsDto(req.impersonator, req.actingAs) });
}

/** Leave "Act as user" and return to the administrator's own account. */
export async function stopActingAs(req, res) {
  if (!req.impersonator) {
    throw new AppError('You are not viewing the app as another user.', { statusCode: 409, code: 'NOT_ACTING_AS' });
  }
  await endActingAs(req.impersonator, req.authSession, req.user, req, 'Exited');
  res.json({ user: authService.publicUser(req.impersonator), actingAs: null, viewedUserId: String(req.user._id) });
}

/** What the sign-in pages may offer (public). */
export async function options(_req, res) {
  const { access } = await getPlatformSettings();
  res.json({ google: env.googleEnabled, signupEnabled: access.signupEnabled });
}

// ---- Sign in with Google (browser navigations, so every answer is a redirect) ----
function clientUrl(path, query) {
  const url = `${env.CLIENT_URL.replace(/\/+$/, '')}${path}`;
  return query ? `${url}?${new URLSearchParams(query)}` : url;
}

function startFlow(res, options) {
  const { url, cookie, maxAge } = googleAuth.beginGoogleFlow(options);
  res.cookie(googleAuth.GOOGLE_FLOW_COOKIE, cookie, { ...googleAuth.flowCookieOptions(), maxAge });
  res.redirect(302, url);
}

export async function googleStart(req, res) {
  if (!env.googleEnabled) return res.redirect(302, clientUrl('/login', { google: 'unavailable' }));
  const returnTo = typeof req.query.returnTo === 'string' ? req.query.returnTo : '/';
  // A bonus code from /signup?bonus=... rides in the sealed flow cookie and is
  // claimed only if Google sign-in creates a new account.
  const bonusCode = typeof req.query.bonus === 'string' ? req.query.bonus : null;
  startFlow(res, { mode: 'login', returnTo, bonusCode });
}

/** Connect Google to the signed-in account (from Account settings). */
export async function googleConnectStart(req, res) {
  if (!env.googleEnabled) return res.redirect(302, clientUrl('/settings/account', { google: 'unavailable' }));
  // An administrator viewing the app as a user must not change that account.
  if (req.impersonator) return res.redirect(302, clientUrl('/settings/account', { google: 'not_allowed' }));
  startFlow(res, { mode: 'link', userId: req.user._id, returnTo: '/settings/account' });
}

export async function googleCallback(req, res) {
  const flow = googleAuth.openFlow(req.cookies?.[googleAuth.GOOGLE_FLOW_COOKIE]);
  res.clearCookie(googleAuth.GOOGLE_FLOW_COOKIE, googleAuth.flowCookieOptions());
  const connecting = flow?.mode === 'link';
  try {
    const google = await googleAuth.completeGoogleFlow(flow, req.query);
    if (connecting) {
      if (!req.user || req.impersonator || String(req.user._id) !== flow.uid) {
        throw new googleAuth.GoogleSignInError('not_signed_in', 'Connect flow finished without the same signed-in user');
      }
      await googleAuth.connectGoogle(req.user, google, req);
      return res.redirect(302, clientUrl('/settings/account', { google: 'connected' }));
    }
    const { token, session } = await googleAuth.signInWithGoogle(google, req, { bonusCode: flow.bonus });
    authService.setSessionCookie(res, token, session);
    return res.redirect(302, clientUrl(flow.returnTo));
  } catch (error) {
    if (!(error instanceof googleAuth.GoogleSignInError)) throw error;
    logger.warn({ code: error.code, reason: error.message, requestId: req.id }, 'Google sign-in refused');
    return res.redirect(302, clientUrl(connecting ? '/settings/account' : '/login', { google: error.code }));
  }
}

const RESET_REQUEST_MESSAGE =
  'If an account exists for that email, a password reset link has been sent. It expires shortly.';

export async function forgotPassword(req, res) {
  await authService.requestPasswordReset(req.validated.body.email, req);
  res.json({ ok: true, message: RESET_REQUEST_MESSAGE });
}

export async function resetPassword(req, res) {
  await authService.resetPassword(req.validated.body, req);
  authService.clearSessionCookie(res);
  res.json({ ok: true, message: 'Your password has been updated. Sign in with the new password.' });
}
