// Authenticated encryption for secrets stored at rest (users' provider API keys).
//
//   AES-256-GCM, 96-bit random IV, 128-bit tag, key = ENCRYPTION_KEY (32 bytes hex).
//   Stored format:  v1.<iv b64url>.<tag b64url>.<ciphertext b64url>
//
// Every ciphertext is bound to "additional authenticated data" (AAD), e.g.
// "<userId>:<provider>". A ciphertext copied onto another user's record (or
// another provider) fails to decrypt instead of silently working.
import crypto from 'node:crypto';
import { env } from '../config/env.js';

const VERSION = 'v1';
const IV_BYTES = 12;

export class DecryptionError extends Error {
  constructor(message = 'Stored secret could not be decrypted') {
    super(message);
    this.name = 'DecryptionError';
  }
}

function keyFrom(hex) {
  const key = Buffer.from(String(hex || ''), 'hex');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex characters)');
  return key;
}

export function encryptSecret(plaintext, { aad, keyHex = env.ENCRYPTION_KEY } = {}) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) throw new Error('Nothing to encrypt');
  if (!aad) throw new Error('encryptSecret requires an aad value');
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFrom(keyHex), iv);
  cipher.setAAD(Buffer.from(String(aad), 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptSecret(payload, { aad, keyHex = env.ENCRYPTION_KEY } = {}) {
  const parts = String(payload || '').split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new DecryptionError('Unknown ciphertext format');
  try {
    const [, ivB64, tagB64, dataB64] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFrom(keyHex), Buffer.from(ivB64, 'base64url'));
    decipher.setAAD(Buffer.from(String(aad), 'utf8'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new DecryptionError();
  }
}

/** Last four characters for display; never more. */
export function lastFour(secret) {
  const value = String(secret || '');
  return value.length >= 8 ? value.slice(-4) : '';
}
