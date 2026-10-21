// Signing key for the OAuth authorization server.
//
// Access tokens are opaque (stored server-side), so the key only signs the
// few JWTs oidc-provider may produce. It is generated once, stored encrypted
// with ENCRYPTION_KEY in AppSettings, and shared by every API instance.
// oidc-provider's built-in development keys are public and never used.
import crypto from 'node:crypto';
import { AppSettings } from '../models/AppSettings.js';
import { encryptSecret, decryptSecret } from '../utils/encryption.js';

const SETTINGS_KEY = 'oauth.signingKey';
const AAD = 'infographic-studio:oauth-signing-key';

function generateJwk() {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = privateKey.export({ format: 'jwk' });
  return { ...jwk, use: 'sig', alg: 'ES256', kid: crypto.randomBytes(12).toString('base64url') };
}

export async function loadSigningJwks() {
  const candidate = generateJwk();
  // The first instance to start stores its key; every later read gets that one.
  await AppSettings.updateOne(
    { key: SETTINGS_KEY },
    { $setOnInsert: { value: { encrypted: encryptSecret(JSON.stringify(candidate), { aad: AAD }), createdAt: new Date() }, updatedBy: 'system' } },
    { upsert: true },
  );
  const stored = await AppSettings.findOne({ key: SETTINGS_KEY }).lean();
  const jwk = JSON.parse(decryptSecret(stored.value.encrypted, { aad: AAD }));
  return { keys: [jwk] };
}
