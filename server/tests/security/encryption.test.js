// AES-256-GCM secret storage: round trip, tamper detection, owner binding.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/unused';
process.env.SESSION_SECRET = 'test-only-session-secret-0123456789abcdef';
process.env.ENCRYPTION_KEY = 'c'.repeat(64);
process.env.EMAIL_PROVIDER = 'memory';

const { encryptSecret, decryptSecret, lastFour, DecryptionError } = await import('../../src/utils/encryption.js');

const SECRET = 'kie_live_0123456789abcdefSECRET';

test('round trip with the same key and AAD', () => {
  const sealed = encryptSecret(SECRET, { aad: 'user1:kie' });
  assert.match(sealed, /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
  assert.ok(!sealed.includes(SECRET));
  assert.equal(decryptSecret(sealed, { aad: 'user1:kie' }), SECRET);
});

test('the same secret encrypts differently every time (random IV)', () => {
  assert.notEqual(encryptSecret(SECRET, { aad: 'a' }), encryptSecret(SECRET, { aad: 'a' }));
});

test('a ciphertext moved to another user or provider does not decrypt', () => {
  const sealed = encryptSecret(SECRET, { aad: 'user1:kie' });
  assert.throws(() => decryptSecret(sealed, { aad: 'user2:kie' }), DecryptionError);
  assert.throws(() => decryptSecret(sealed, { aad: 'user1:other' }), DecryptionError);
});

test('any tampering is detected', () => {
  const sealed = encryptSecret(SECRET, { aad: 'u:kie' });
  const parts = sealed.split('.');
  const flipped = Buffer.from(parts[3], 'base64url');
  flipped[0] ^= 1;
  const tampered = [parts[0], parts[1], parts[2], flipped.toString('base64url')].join('.');
  assert.throws(() => decryptSecret(tampered, { aad: 'u:kie' }), DecryptionError);
  assert.throws(() => decryptSecret('v0.a.b.c', { aad: 'u:kie' }), DecryptionError);
  assert.throws(() => decryptSecret('garbage', { aad: 'u:kie' }), DecryptionError);
});

test('a different ENCRYPTION_KEY cannot decrypt', () => {
  const sealed = encryptSecret(SECRET, { aad: 'u:kie' });
  assert.throws(() => decryptSecret(sealed, { aad: 'u:kie', keyHex: 'd'.repeat(64) }), DecryptionError);
});

test('only the last four characters are ever derived for display', () => {
  assert.equal(lastFour(SECRET), 'CRET');
  assert.equal(lastFour('short'), '');
});
