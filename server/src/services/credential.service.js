// Users' own provider API keys.
//
//   - Stored encrypted (AES-256-GCM, ENCRYPTION_KEY, bound to user + provider).
//   - Returned to the owner only as last-4 + status + balance; never in full,
//     never to admins (who see provider + status only), never logged.
//   - Tested with a non-generation call (Kie.ai credit balance).
//   - Decrypted only inside the server, by the job worker, just before a call.
import { ApiCredential } from '../models/ApiCredential.js';
import { getProvider, ProviderError } from '../providers/providerRegistry.js';
import { encryptSecret, decryptSecret, lastFour, DecryptionError } from '../utils/encryption.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import { logger } from '../config/logger.js';
import { recordAudit } from './audit.service.js';

const KEY_SHAPE = /^[A-Za-z0-9._\-:]{16,200}$/;

function aadFor(userId, provider) {
  return `${String(userId)}:${provider}`;
}

function requireProvider(key) {
  const provider = getProvider(key);
  if (!provider) throw new NotFoundError(`Unknown provider "${key}"`);
  return provider;
}

export function toCredentialDto(credential) {
  if (!credential) return null;
  return {
    provider: credential.provider,
    last4: credential.last4 || '',
    status: credential.status,
    lastVerifiedAt: credential.lastVerifiedAt || null,
    lastCheckError: credential.lastCheckError || null,
    balance: typeof credential.balance === 'number' ? credential.balance : null,
    balanceCheckedAt: credential.balanceCheckedAt || null,
    createdAt: credential.createdAt,
    updatedAt: credential.updatedAt,
  };
}

/** What an administrator may see: never the key, never its last digits. */
export function toAdminCredentialDto(credential) {
  return {
    provider: credential.provider,
    status: credential.status,
    lastVerifiedAt: credential.lastVerifiedAt || null,
    updatedAt: credential.updatedAt,
  };
}

export async function listCredentials(userId) {
  const items = await ApiCredential.find({ userId }).sort({ provider: 1 }).lean();
  return items.map(toCredentialDto);
}

export async function listCredentialsForAdmin(userId) {
  const items = await ApiCredential.find({ userId }).sort({ provider: 1 }).lean();
  return items.map(toAdminCredentialDto);
}

/** Run the provider's non-generation key check. Never throws for provider errors. */
async function checkKey(provider, apiKey) {
  try {
    const { balance } = await provider.verifyKey(apiKey);
    return { ok: true, balance, error: null, rejected: false };
  } catch (error) {
    if (error instanceof ProviderError) {
      return { ok: false, balance: null, error: error.message, rejected: error.kind === 'auth' };
    }
    throw error;
  }
}

export async function saveCredential(user, providerKey, rawKey, req) {
  const provider = requireProvider(providerKey);
  const apiKey = String(rawKey || '').trim();
  if (!KEY_SHAPE.test(apiKey)) {
    throw new AppError('That does not look like a valid API key.', { statusCode: 400, code: 'KEY_FORMAT_INVALID' });
  }

  const check = await checkKey(provider, apiKey);
  if (check.rejected) {
    await recordAudit({
      req,
      actor: user,
      action: 'credentials.save',
      area: 'account',
      outcome: 'failure',
      summary: `${provider.name} rejected the key`,
      metadata: { provider: provider.key },
    });
    throw new AppError(`${provider.name} rejected this API key. Check it and try again.`, {
      statusCode: 400,
      code: 'KEY_REJECTED',
    });
  }

  const now = new Date();
  const existing = await ApiCredential.exists({ userId: user._id, provider: provider.key });
  const credential = await ApiCredential.findOneAndUpdate(
    { userId: user._id, provider: provider.key },
    {
      $set: {
        encryptedKey: encryptSecret(apiKey, { aad: aadFor(user._id, provider.key) }),
        last4: lastFour(apiKey),
        status: check.ok ? 'valid' : 'unverified',
        lastVerifiedAt: check.ok ? now : null,
        lastCheckError: check.ok ? null : check.error,
        balance: check.ok ? check.balance : null,
        balanceCheckedAt: check.ok ? now : null,
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).lean();

  await recordAudit({
    req,
    actor: user,
    action: existing ? 'credentials.replaced' : 'credentials.added',
    area: 'account',
    summary: `${provider.name} key ${existing ? 'replaced' : 'added'}${check.ok ? ' (verified)' : ' (not verified yet)'}`,
    metadata: { provider: provider.key, verified: check.ok },
  });

  return {
    credential: toCredentialDto(credential),
    verification: { ok: check.ok, balance: check.balance, error: check.error },
  };
}

/** Internal: the decrypted key for the worker. Returns null when none is stored. */
export async function getDecryptedKey(userId, providerKey) {
  const credential = await ApiCredential.findOne({ userId, provider: providerKey }).select('+encryptedKey').lean();
  if (!credential) return null;
  try {
    return { apiKey: decryptSecret(credential.encryptedKey, { aad: aadFor(userId, providerKey) }), credential };
  } catch (error) {
    if (error instanceof DecryptionError) {
      logger.error({ userId: String(userId), provider: providerKey }, 'Stored API key could not be decrypted (ENCRYPTION_KEY changed?)');
      throw new AppError('Your stored API key could not be read. Please add it again in API settings.', {
        statusCode: 409,
        code: 'KEY_UNREADABLE',
      });
    }
    throw error;
  }
}

export async function verifyCredential(user, providerKey, req) {
  const provider = requireProvider(providerKey);
  const stored = await getDecryptedKey(user._id, provider.key);
  if (!stored) throw new NotFoundError(`No ${provider.name} key saved`);

  const check = await checkKey(provider, stored.apiKey);
  const now = new Date();
  const update = check.ok
    ? { status: 'valid', lastVerifiedAt: now, lastCheckError: null, balance: check.balance, balanceCheckedAt: now }
    : { status: check.rejected ? 'invalid' : stored.credential.status, lastCheckError: check.error };
  const credential = await ApiCredential.findOneAndUpdate({ userId: user._id, provider: provider.key }, { $set: update }, { returnDocument: 'after' }).lean();

  await recordAudit({
    req,
    actor: user,
    action: 'credentials.tested',
    area: 'account',
    outcome: check.ok ? 'success' : 'failure',
    summary: check.ok ? `${provider.name} key works` : check.error,
    metadata: { provider: provider.key },
  });

  return { credential: toCredentialDto(credential), verification: { ok: check.ok, balance: check.balance, error: check.error } };
}

export async function deleteCredential(user, providerKey, req) {
  const provider = requireProvider(providerKey);
  const result = await ApiCredential.deleteOne({ userId: user._id, provider: provider.key });
  if (!result.deletedCount) throw new NotFoundError(`No ${provider.name} key saved`);
  await recordAudit({
    req,
    actor: user,
    action: 'credentials.deleted',
    area: 'account',
    summary: `${provider.name} key removed`,
    metadata: { provider: provider.key },
  });
}

/** Called by the worker when the provider rejects a stored key. */
export async function markCredentialInvalid(userId, providerKey, message) {
  await ApiCredential.updateOne(
    { userId, provider: providerKey },
    { $set: { status: 'invalid', lastCheckError: String(message || 'Rejected by provider').slice(0, 300) } },
  );
}

export async function recordBalance(userId, providerKey, balance) {
  if (typeof balance !== 'number') return;
  await ApiCredential.updateOne({ userId, provider: providerKey }, { $set: { balance, balanceCheckedAt: new Date() } });
}
