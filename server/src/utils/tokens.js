// Opaque random tokens (sessions, password resets).
//
// The raw token only ever exists in the user's cookie or email link. The
// database stores an HMAC-SHA256 of it keyed with SESSION_SECRET, so a copy of
// the database alone cannot be replayed as a valid session or reset link.
import crypto from 'node:crypto';
import { env } from '../config/env.js';

export function generateToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function hashToken(token, secret = env.SESSION_SECRET) {
  return crypto.createHmac('sha256', secret).update(String(token)).digest('hex');
}

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{20,200}$/;

export function looksLikeToken(value) {
  return typeof value === 'string' && TOKEN_SHAPE.test(value);
}
