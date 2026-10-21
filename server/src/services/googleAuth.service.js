// Sign in with Google (OpenID Connect, authorization code flow with PKCE).
//
// The browser is sent to Google with a random state, nonce and PKCE
// challenge. The matching secrets travel in a short-lived, signed, httpOnly
// cookie scoped to /api/auth/google. On the way back the server checks the
// state, exchanges the code with the client secret over the back channel and
// verifies the ID token with Google's published keys (issuer, audience,
// expiry, nonce). Only a Google-verified email is accepted.
//
// Account rules:
//   - A Google account already connected to an AI Infographic Studio account signs into it.
//   - A new Google account creates a regular user account without a password
//     (only while sign-ups are open).
//   - An existing AI Infographic Studio account with the same email is NOT connected
//     automatically. Its owner signs in with the password and connects Google
//     in Account settings. Sign-up does not verify email addresses, so
//     connecting by email would let whoever registered the address first keep
//     a password into the Google user's account.
//   - Disconnecting needs a password on the account, so nobody is locked out.
import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/errors.js';
import { normalizeEmail } from '../utils/sanitize.js';
import { recordAudit } from './audit.service.js';
import { assertSignupAllowed, assertAppAccess } from './platformSettings.service.js';
import { createSession } from './auth.service.js';

export const GOOGLE_FLOW_COOKIE = 'iv_google';
const FLOW_PATH = '/api/auth/google';
const FLOW_TTL_MS = 10 * 60 * 1000;
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/**
 * A refused Google sign-in. `code` goes back to the browser as ?google=<code>;
 * `message` is only logged and never contains a secret.
 */
export class GoogleSignInError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'GoogleSignInError';
    this.code = code;
  }
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// ---- the flow cookie -----------------------------------------------------------
function mac(body) {
  return crypto.createHmac('sha256', env.SESSION_SECRET).update(`google-flow.${body}`).digest('base64url');
}

function sealFlow(flow) {
  const body = Buffer.from(JSON.stringify(flow)).toString('base64url');
  return `${body}.${mac(body)}`;
}

/** The flow stored by beginGoogleFlow, or null when missing, forged or expired. */
export function openFlow(value) {
  if (typeof value !== 'string' || value.length > 4000) return null;
  const [body, signature, extra] = value.split('.');
  if (!body || !signature || extra !== undefined || !safeEqual(signature, mac(body))) return null;
  try {
    const flow = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!flow || typeof flow !== 'object' || typeof flow.exp !== 'number' || Date.now() > flow.exp) return null;
    return flow;
  } catch {
    return null;
  }
}

/** Lax, not the session cookie's setting: Google sends the browser back cross-site. */
export function flowCookieOptions() {
  const options = { httpOnly: true, secure: env.cookieSecure, sameSite: 'lax', path: FLOW_PATH };
  if (env.COOKIE_DOMAIN) options.domain = env.COOKIE_DOMAIN;
  return options;
}

/** A path inside this app to land on afterwards; anything else becomes "/". */
export function safeReturnTo(value) {
  if (typeof value !== 'string' || value.length > 300) return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[\u0000-\u001f]/.test(value)) return '/';
  return value;
}

/** Start a sign-in ("login") or a connect-from-settings ("link") flow. */
export function beginGoogleFlow({ mode, userId = null, returnTo = '/' }) {
  const state = crypto.randomBytes(32).toString('base64url');
  const nonce = crypto.randomBytes(32).toString('base64url');
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const flow = {
    mode: mode === 'link' ? 'link' : 'login',
    uid: userId ? String(userId) : null,
    state,
    nonce,
    verifier,
    returnTo: safeReturnTo(returnTo),
    exp: Date.now() + FLOW_TTL_MS,
  };
  const url = new URL(env.GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.googleRedirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return { url: url.toString(), cookie: sealFlow(flow), maxAge: FLOW_TTL_MS };
}

// ---- talking to Google ---------------------------------------------------------
async function exchangeCode(code, verifier) {
  let response;
  try {
    response = await fetch(env.GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: env.googleRedirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    throw new GoogleSignInError('failed', `Google token request failed (${error.name})`);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || typeof body?.id_token !== 'string') {
    const reason = typeof body?.error === 'string' ? ` (${body.error.slice(0, 60)})` : '';
    throw new GoogleSignInError('failed', `Google token exchange answered ${response.status}${reason}`);
  }
  return body.id_token;
}

let googleKeys = null;

async function verifyIdToken(idToken, nonce) {
  googleKeys ??= createRemoteJWKSet(new URL(env.GOOGLE_JWKS_URL), { timeoutDuration: 10000 });
  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, googleKeys, {
      issuer: GOOGLE_ISSUERS,
      audience: env.GOOGLE_CLIENT_ID,
      algorithms: ['RS256'],
      clockTolerance: 60,
    }));
  } catch (error) {
    throw new GoogleSignInError('failed', `Google ID token rejected (${error.code || error.name})`);
  }
  if (typeof payload.nonce !== 'string' || !safeEqual(payload.nonce, nonce)) {
    throw new GoogleSignInError('failed', 'Google ID token nonce does not match');
  }
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255) {
    throw new GoogleSignInError('failed', 'Google ID token has no subject');
  }
  const verified = payload.email_verified === true || payload.email_verified === 'true';
  if (typeof payload.email !== 'string' || !payload.email.includes('@') || !verified) {
    throw new GoogleSignInError('unverified_email', 'The Google account has no verified email');
  }
  return {
    sub: payload.sub,
    email: normalizeEmail(payload.email),
    name: typeof payload.name === 'string' ? payload.name : null,
  };
}

/** Check Google's answer against the flow and return the verified Google identity. */
export async function completeGoogleFlow(flow, query) {
  if (!flow) throw new GoogleSignInError('expired', 'Google sign-in cookie missing, forged or expired');
  if (query.error) {
    throw new GoogleSignInError(query.error === 'access_denied' ? 'cancelled' : 'failed', 'Google returned an error');
  }
  if (typeof query.state !== 'string' || !safeEqual(query.state, flow.state)) {
    throw new GoogleSignInError('expired', 'Google sign-in state does not match');
  }
  if (typeof query.code !== 'string' || !query.code || query.code.length > 2048) {
    throw new GoogleSignInError('failed', 'Google returned no authorization code');
  }
  const idToken = await exchangeCode(query.code, flow.verifier);
  return verifyIdToken(idToken, flow.nonce);
}

// ---- accounts --------------------------------------------------------------------
const auditTarget = (user) => ({ type: 'user', id: user._id, email: user.email });

function displayName(google) {
  const name = (google.name || '').trim().slice(0, 80);
  if (name.length >= 2) return name;
  const local = google.email.split('@')[0].slice(0, 80);
  return local.length >= 2 ? local : 'Studio user';
}

/** Sign in (or sign up) with a verified Google identity. Returns { user, token, session, created }. */
export async function signInWithGoogle(google, req) {
  let created = false;
  let user = await User.findOne({ googleId: google.sub });
  if (!user) {
    const existing = await User.findOne({ email: google.email });
    if (existing) {
      await recordAudit({
        req,
        actor: google.email,
        action: 'auth.login',
        area: 'auth',
        outcome: 'failure',
        target: auditTarget(existing),
        summary: 'Google sign-in refused: this email has an account that is not connected to Google',
        metadata: { method: 'google' },
      });
      throw new GoogleSignInError('email_in_use', 'Email belongs to an account not connected to Google');
    }
    try {
      await assertSignupAllowed();
    } catch (error) {
      if (error?.code === 'SIGNUP_DISABLED') throw new GoogleSignInError('signup_disabled', 'Sign-ups are closed');
      throw error;
    }
    try {
      // Role and status are fixed here, as for every public sign-up.
      user = await User.create({
        name: displayName(google),
        email: google.email,
        passwordHash: null,
        googleId: google.sub,
        googleEmail: google.email,
        role: 'user',
        status: 'active',
      });
      created = true;
    } catch (error) {
      if (error?.code !== 11000) throw error;
      // Another request created it meanwhile.
      user = await User.findOne({ googleId: google.sub });
      if (!user) throw new GoogleSignInError('email_in_use', 'Email was registered meanwhile');
    }
  }

  if (user.status !== 'active') {
    await recordAudit({
      req,
      actor: user,
      action: 'auth.login',
      area: 'auth',
      outcome: 'failure',
      target: auditTarget(user),
      summary: 'Account suspended',
      metadata: { method: 'google' },
    });
    throw new GoogleSignInError('suspended', 'Account suspended');
  }
  try {
    await assertAppAccess(user);
  } catch (error) {
    if (error?.code === 'MAINTENANCE') throw new GoogleSignInError('maintenance', 'Maintenance mode');
    throw error;
  }

  if (user.googleEmail !== google.email) user.googleEmail = google.email;
  user.lastLoginAt = new Date();
  await user.save();
  const { token, session } = await createSession(user, { persistent: true, req });
  await recordAudit({
    req,
    actor: user,
    action: created ? 'auth.signup' : 'auth.login',
    area: 'auth',
    target: auditTarget(user),
    metadata: { method: 'google' },
  });
  return { user, token, session, created };
}

/** Connect a verified Google identity to the signed-in account. */
export async function connectGoogle(user, google, req) {
  const owner = await User.findOne({ googleId: google.sub });
  if (owner && String(owner._id) !== String(user._id)) {
    await recordAudit({
      req,
      actor: user,
      action: 'account.google_connected',
      area: 'account',
      outcome: 'failure',
      target: auditTarget(user),
      summary: 'This Google account is connected to another AI Infographic Studio account',
    });
    throw new GoogleSignInError('already_linked', 'Google account belongs to another user');
  }
  try {
    await User.updateOne({ _id: user._id }, { $set: { googleId: google.sub, googleEmail: google.email } });
  } catch (error) {
    if (error?.code === 11000) throw new GoogleSignInError('already_linked', 'Google account belongs to another user');
    throw error;
  }
  await recordAudit({
    req,
    actor: user,
    action: 'account.google_connected',
    area: 'account',
    target: auditTarget(user),
    metadata: { googleEmail: google.email },
  });
}

export async function disconnectGoogle(user, req) {
  const current = await User.findById(user._id).select('+passwordHash');
  if (!current?.googleId) {
    throw new AppError('Google is not connected to this account.', { statusCode: 409, code: 'GOOGLE_NOT_CONNECTED' });
  }
  if (!current.passwordHash) {
    throw new AppError('Set a password first, so you can still sign in after disconnecting Google.', {
      statusCode: 409,
      code: 'PASSWORD_REQUIRED',
    });
  }
  const googleEmail = current.googleEmail;
  await User.updateOne({ _id: user._id }, { $set: { googleId: null, googleEmail: null } });
  await recordAudit({
    req,
    actor: user,
    action: 'account.google_disconnected',
    area: 'account',
    target: auditTarget(user),
    metadata: { googleEmail },
  });
  return signInMethods(await User.findById(user._id));
}

/** How this account can sign in, for Account settings. */
export async function signInMethods(user) {
  const hasPassword = Boolean(await User.exists({ _id: user._id, passwordHash: { $type: 'string' } }));
  return {
    hasPassword,
    google: { available: env.googleEnabled, connected: Boolean(user.googleId), email: user.googleEmail || null },
  };
}
