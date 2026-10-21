// Password hashing with Node's built-in scrypt (no native dependency).
//
// Stored format:  scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>
// The parameters live in the hash so they can be raised later; needsRehash()
// tells the login flow to upgrade a hash created with weaker parameters.
//
// Production parameters follow the OWASP password-storage guidance for scrypt
// (N=2^15, r=8, p=3; about 32 MiB of memory per hash). Automated tests use a
// cheaper setting so the suite stays fast; NODE_ENV decides which applies.
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(crypto.scrypt);

const KEY_LENGTH = 64;
const SALT_BYTES = 16;

export const PASSWORD_POLICY = Object.freeze({ min: 8, max: 128 });

function currentParams() {
  return process.env.NODE_ENV === 'test' ? { N: 2 ** 12, r: 8, p: 1 } : { N: 2 ** 15, r: 8, p: 3 };
}

function maxmemFor({ N, r, p }) {
  // scrypt needs roughly 128 * N * r * p bytes; give it headroom.
  return 128 * N * r * p * 2 + 16 * 1024 * 1024;
}

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length === 0) throw new Error('Password must be a non-empty string');
  const params = currentParams();
  const salt = crypto.randomBytes(SALT_BYTES);
  const derived = await scryptAsync(password.normalize('NFKC'), salt, KEY_LENGTH, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: maxmemFor(params),
  });
  return ['scrypt', params.N, params.r, params.p, salt.toString('base64'), derived.toString('base64')].join('$');
}

function parse(stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [, N, r, p, salt, hash] = parts;
  const params = { N: Number(N), r: Number(r), p: Number(p) };
  if (!Number.isInteger(params.N) || !Number.isInteger(params.r) || !Number.isInteger(params.p)) return null;
  return { params, salt: Buffer.from(salt, 'base64'), hash: Buffer.from(hash, 'base64') };
}

export async function verifyPassword(password, stored) {
  const parsed = parse(stored);
  if (!parsed || typeof password !== 'string') return false;
  const derived = await scryptAsync(password.normalize('NFKC'), parsed.salt, parsed.hash.length, {
    ...parsed.params,
    maxmem: maxmemFor(parsed.params),
  });
  return derived.length === parsed.hash.length && crypto.timingSafeEqual(derived, parsed.hash);
}

export function needsRehash(stored) {
  const parsed = parse(stored);
  if (!parsed) return true;
  const target = currentParams();
  return parsed.params.N < target.N || parsed.params.r < target.r || parsed.params.p < target.p;
}

/** Returns an error message, or null when the password meets the policy. */
export function checkPasswordPolicy(password, { min = PASSWORD_POLICY.min } = {}) {
  const value = String(password || '');
  if (value.length < min) return `Password must be at least ${min} characters`;
  if (value.length > PASSWORD_POLICY.max) return `Password must be ${PASSWORD_POLICY.max} characters or fewer`;
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return 'Password must contain at least one letter and one number';
  return null;
}

let dummyHashPromise = null;
/**
 * Verify against a throwaway hash so a login for an unknown email takes about
 * as long as one for a known email (prevents account enumeration by timing).
 */
export async function burnPasswordCheck(password) {
  if (!dummyHashPromise) dummyHashPromise = hashPassword(crypto.randomBytes(24).toString('hex'));
  await verifyPassword(String(password || ''), await dummyHashPromise);
  return false;
}
