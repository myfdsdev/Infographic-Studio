// Platform credits and the platform's own provider key.
//
// Generation is paid in this order:
//   1. platform credits: the user's balance pays (credits per infographic, set
//      by an administrator) and the job runs on the PLATFORM's Kie.ai key;
//   2. otherwise the user's own key (BYOK), exactly as before.
// When neither is available nothing is started (NO_CREDITS / NO_API_KEY).
//
// The platform key is saved by an administrator (Admin > Provider), encrypted
// with ENCRYPTION_KEY like users' keys, and never returned in full. Users never
// see it and it is never used for a job that was not paid with credits.
//
// Credits change only through atomic $inc updates, each recorded in the
// CreditTransaction ledger. Spending is reserved before a job is created and
// returned at once if nothing is created; a generation that finally fails or
// is cancelled is refunded once.
import { AppSettings } from '../models/AppSettings.js';
import { ApiCredential } from '../models/ApiCredential.js';
import { User } from '../models/User.js';
import { CreditTransaction } from '../models/CreditTransaction.js';
import { getProvider, ProviderError } from '../providers/providerRegistry.js';
import { encryptSecret, decryptSecret, lastFour, DecryptionError } from '../utils/encryption.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import { logger } from '../config/logger.js';
import { recordAudit } from './audit.service.js';
import { getPlatformSettings } from './platformSettings.service.js';
import { getDecryptedKey, markCredentialInvalid } from './credential.service.js';

const PROVIDER_KEY = 'kie';
const SETTINGS_KEY = 'platform_provider_key';
const KEY_SHAPE = /^[A-Za-z0-9._\-:]{16,200}$/;
const AAD = `platform:${PROVIDER_KEY}`;

function provider() {
  return getProvider(PROVIDER_KEY);
}

// ---------------------------------------------------------------- platform key

async function readPlatformKeyDoc() {
  const doc = await AppSettings.findOne({ key: SETTINGS_KEY }).lean();
  return doc?.value?.encryptedKey ? doc.value : null;
}

/** What an administrator sees: status, last 4, balance. Never the key. */
export function toPlatformKeyDto(value) {
  if (!value) return { provider: PROVIDER_KEY, configured: false };
  return {
    provider: PROVIDER_KEY,
    configured: true,
    last4: value.last4 || '',
    status: value.status,
    balance: typeof value.balance === 'number' ? value.balance : null,
    lastVerifiedAt: value.lastVerifiedAt || null,
    lastCheckError: value.lastCheckError || null,
    updatedAt: value.updatedAt || null,
    updatedBy: value.updatedBy || null,
  };
}

export async function getPlatformKeyStatus() {
  return toPlatformKeyDto(await readPlatformKeyDoc());
}

/** True when credit-paid jobs can run (a key is saved and was not rejected). */
export async function platformKeyUsable() {
  const value = await readPlatformKeyDoc();
  return Boolean(value && value.status !== 'invalid');
}

async function checkKey(apiKey) {
  try {
    const { balance } = await provider().verifyKey(apiKey);
    return { ok: true, balance, error: null, rejected: false };
  } catch (error) {
    if (error instanceof ProviderError) return { ok: false, balance: null, error: error.message, rejected: error.kind === 'auth' };
    throw error;
  }
}

async function writePlatformKey(value) {
  await AppSettings.updateOne({ key: SETTINGS_KEY }, { $set: { value, updatedBy: value.updatedBy || null } }, { upsert: true });
}

export async function savePlatformKey(actor, rawKey, req) {
  const apiKey = String(rawKey || '').trim();
  if (!KEY_SHAPE.test(apiKey)) {
    throw new AppError('That does not look like a valid API key.', { statusCode: 400, code: 'KEY_FORMAT_INVALID' });
  }
  const check = await checkKey(apiKey);
  if (check.rejected) {
    await recordAudit({ req, actor, action: 'admin.platform_key_saved', area: 'admin', outcome: 'failure', summary: 'Kie.ai rejected the platform key' });
    throw new AppError('Kie.ai rejected this API key. Check it and try again.', { statusCode: 400, code: 'KEY_REJECTED' });
  }
  const existed = Boolean(await readPlatformKeyDoc());
  const now = new Date();
  const value = {
    encryptedKey: encryptSecret(apiKey, { aad: AAD }),
    last4: lastFour(apiKey),
    status: check.ok ? 'valid' : 'unverified',
    balance: check.ok ? check.balance : null,
    lastVerifiedAt: check.ok ? now : null,
    lastCheckError: check.ok ? null : check.error,
    updatedAt: now,
    updatedBy: actor?.email || null,
  };
  await writePlatformKey(value);
  await recordAudit({
    req,
    actor,
    action: 'admin.platform_key_saved',
    area: 'admin',
    target: { type: 'settings', id: SETTINGS_KEY },
    summary: `Platform Kie.ai key ${existed ? 'replaced' : 'added'}${check.ok ? ' (verified)' : ' (not verified yet)'}`,
  });
  return { key: toPlatformKeyDto(value), verification: { ok: check.ok, balance: check.balance, error: check.error } };
}

async function decryptPlatformKey(value) {
  try {
    return decryptSecret(value.encryptedKey, { aad: AAD });
  } catch (error) {
    if (error instanceof DecryptionError) {
      logger.error('The platform API key could not be decrypted (ENCRYPTION_KEY changed?)');
      throw new AppError('The platform API key could not be read. An administrator must save it again.', {
        statusCode: 409,
        code: 'KEY_UNREADABLE',
      });
    }
    throw error;
  }
}

export async function testPlatformKey(actor, req) {
  const value = await readPlatformKeyDoc();
  if (!value) throw new NotFoundError('No platform Kie.ai key saved');
  const check = await checkKey(await decryptPlatformKey(value));
  const now = new Date();
  const next = check.ok
    ? { ...value, status: 'valid', balance: check.balance, lastVerifiedAt: now, lastCheckError: null }
    : { ...value, status: check.rejected ? 'invalid' : value.status, lastCheckError: check.error };
  await writePlatformKey(next);
  await recordAudit({
    req,
    actor,
    action: 'admin.platform_key_tested',
    area: 'admin',
    outcome: check.ok ? 'success' : 'failure',
    summary: check.ok ? 'Platform Kie.ai key works' : check.error,
  });
  return { key: toPlatformKeyDto(next), verification: { ok: check.ok, balance: check.balance, error: check.error } };
}

export async function deletePlatformKey(actor, req) {
  const result = await AppSettings.deleteOne({ key: SETTINGS_KEY });
  if (!result.deletedCount) throw new NotFoundError('No platform Kie.ai key saved');
  await recordAudit({ req, actor, action: 'admin.platform_key_deleted', area: 'admin', summary: 'Platform Kie.ai key removed' });
}

async function markPlatformKeyInvalid(message) {
  const value = await readPlatformKeyDoc();
  if (!value) return;
  await writePlatformKey({ ...value, status: 'invalid', lastCheckError: String(message || 'Rejected by provider').slice(0, 300) });
  logger.error('Kie.ai rejected the platform API key; credit-paid generation is paused until an administrator replaces it');
}

// ---------------------------------------------------------------- job keys

/**
 * The key a job runs on: the platform key for credit-paid jobs, otherwise the
 * user's own. Returns { apiKey } or null when that key is missing.
 */
export async function getJobKey(job) {
  if (job.keySource === 'platform') {
    const value = await readPlatformKeyDoc();
    return value ? { apiKey: await decryptPlatformKey(value) } : null;
  }
  return getDecryptedKey(job.userId, job.provider);
}

/** The provider rejected the key a job used. */
export async function markJobKeyInvalid(job, message) {
  if (job.keySource === 'platform') return markPlatformKeyInvalid(message);
  return markCredentialInvalid(job.userId, job.provider, message);
}

// ---------------------------------------------------------------- credits

export async function creditsPerInfographic() {
  const settings = await getPlatformSettings();
  return settings.credits.perInfographic;
}

async function record(userId, amount, reason, fields = {}) {
  const user = await User.findById(userId).select('credits').lean();
  await CreditTransaction.create({ userId, amount, reason, balanceAfter: user?.credits ?? null, ...fields });
}

/** Add credits (grant, refund, admin top-up). */
export async function addCredits(userId, amount, reason, fields = {}) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('addCredits needs a positive whole amount');
  await User.updateOne({ _id: userId }, { $inc: { credits: amount } });
  await record(userId, amount, reason, fields);
}

/**
 * Take `amount` credits only if the balance covers it. Atomic: two requests
 * at once can never spend the same credits. Returns true when taken.
 */
async function takeCredits(userId, amount) {
  const result = await User.updateOne({ _id: userId, credits: { $gte: amount } }, { $inc: { credits: -amount } });
  return result.modifiedCount === 1;
}

/**
 * Decide how one infographic is paid, before anything is created:
 *   - { source: 'platform', credits } when credits were reserved;
 *   - { source: 'user', credits: 0 } when the user's own key will be used.
 * Throws NO_CREDITS / NO_API_KEY / API_KEY_INVALID when neither works.
 * A reservation must be returned with releaseReservation() if no infographic
 * ends up being created for it.
 */
export async function reserveForInfographic(user) {
  const cost = await creditsPerInfographic();
  const platformReady = await platformKeyUsable();
  if (platformReady && (await takeCredits(user._id, cost))) {
    return { source: 'platform', credits: cost };
  }

  const credential = await ApiCredential.findOne({ userId: user._id, provider: PROVIDER_KEY }).select('status').lean();
  if (credential && credential.status !== 'invalid') return { source: 'user', credits: 0 };

  if (credential?.status === 'invalid') {
    throw new AppError('Kie.ai rejected your saved API key. Replace it in API Settings before generating.', {
      statusCode: 400,
      code: 'API_KEY_INVALID',
    });
  }
  if (platformReady) {
    throw new AppError(
      `You need ${cost} credits for an infographic and have ${user.credits || 0}. Add your own Kie.ai API key in API Settings to keep generating.`,
      { statusCode: 400, code: 'NO_CREDITS', details: { required: cost, balance: user.credits || 0 } },
    );
  }
  throw new AppError('Connect your own Kie.ai API key in API Settings before generating.', { statusCode: 400, code: 'NO_API_KEY' });
}

/** Give back a reservation that did not become an infographic. */
export async function releaseReservation(userId, billing) {
  if (billing?.source !== 'platform' || !billing.credits) return;
  await User.updateOne({ _id: userId }, { $inc: { credits: billing.credits } });
}

/** Record spending once the infographic exists. */
export async function recordSpend(userId, billing, infographicId) {
  if (billing?.source !== 'platform' || !billing.credits) return;
  await record(userId, -billing.credits, 'generation', { infographicId });
}

/**
 * Refund a failed or cancelled credit-paid infographic. The refundedAt flag
 * is set atomically first, so a refund happens at most once.
 */
export async function refundInfographic(InfographicModel, item) {
  if (item.billing?.source !== 'platform' || !item.billing.credits) return false;
  const claimed = await InfographicModel.updateOne(
    { _id: item._id, 'billing.source': 'platform', 'billing.refundedAt': null },
    { $set: { 'billing.refundedAt': new Date() } },
  );
  if (!claimed.modifiedCount) return false;
  await addCredits(item.userId, item.billing.credits, 'refund', { infographicId: item._id, note: 'Generation did not finish' });
  return true;
}

/**
 * A retried credit-paid infographic is charged again if its credits were
 * already refunded. Throws NO_CREDITS / PLATFORM_KEY_UNAVAILABLE otherwise.
 */
export async function chargeRetry(InfographicModel, infographicId) {
  if (!(await platformKeyUsable())) {
    throw new AppError('Credit-paid generation is unavailable right now. Try again later.', {
      statusCode: 503,
      code: 'PLATFORM_KEY_UNAVAILABLE',
    });
  }
  const item = infographicId ? await InfographicModel.findById(infographicId).select('userId billing').lean() : null;
  if (!item?.billing?.refundedAt) return;
  const cost = item.billing.credits;
  if (!(await takeCredits(item.userId, cost))) {
    throw new AppError(`Retrying needs ${cost} credits again.`, { statusCode: 400, code: 'NO_CREDITS', details: { required: cost } });
  }
  await InfographicModel.updateOne({ _id: item._id }, { $set: { 'billing.refundedAt': null } });
  await record(item.userId, -cost, 'generation', { infographicId: item._id, note: 'Retry' });
}

/** Can this user generate right now, and how? (for the client and MCP). */
export async function generationAccess(user) {
  const [cost, platformReady, credential, fresh] = await Promise.all([
    creditsPerInfographic(),
    platformKeyUsable(),
    ApiCredential.findOne({ userId: user._id, provider: PROVIDER_KEY }).select('status').lean(),
    User.findById(user._id).select('credits').lean(),
  ]);
  const balance = fresh?.credits || 0;
  const ownKey = credential ? credential.status : 'none';
  const creditsUsable = platformReady && balance >= cost;
  return {
    credits: balance,
    creditsPerInfographic: cost,
    infographicsLeft: platformReady ? Math.floor(balance / cost) : 0,
    platformAvailable: platformReady,
    ownKey,
    // What the next generation uses: 'credits', 'own_key' or null (blocked).
    nextSource: creditsUsable ? 'credits' : ownKey !== 'none' && ownKey !== 'invalid' ? 'own_key' : null,
  };
}

export async function listTransactions(userId, { limit = 20 } = {}) {
  const items = await CreditTransaction.find({ userId }).sort({ createdAt: -1 }).limit(Math.min(Math.max(1, limit), 100)).lean();
  return items.map((item) => ({
    id: String(item._id),
    amount: item.amount,
    balanceAfter: item.balanceAfter,
    reason: item.reason,
    note: item.note || null,
    infographicId: item.infographicId ? String(item.infographicId) : null,
    createdAt: item.createdAt,
  }));
}

/** Admin: add or remove credits (never below zero). */
export async function adjustCredits(actor, userId, amount, note, req) {
  const user = await User.findById(userId).select('email credits').lean();
  if (!user) throw new NotFoundError('User not found');
  if (amount > 0) {
    await addCredits(user._id, amount, 'admin_adjustment', { note, actorId: actor._id });
  } else {
    const taken = await takeCredits(user._id, -amount);
    if (!taken) {
      throw new AppError(`This user has only ${user.credits || 0} credits.`, { statusCode: 400, code: 'NOT_ENOUGH_CREDITS' });
    }
    await record(user._id, amount, 'admin_adjustment', { note, actorId: actor._id });
  }
  await recordAudit({
    req,
    actor,
    action: 'admin.credits_adjusted',
    area: 'admin',
    target: { type: 'user', id: user._id, email: user.email },
    summary: `${amount > 0 ? 'Added' : 'Removed'} ${Math.abs(amount)} credits${note ? `: ${note}` : ''}`.slice(0, 500),
    metadata: { amount },
  });
  const fresh = await User.findById(user._id).select('credits').lean();
  return { credits: fresh?.credits || 0 };
}
