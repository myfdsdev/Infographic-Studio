// Bonus sign-up links: an administrator creates a link worth N credits; a
// NEW account created through it (email or Google sign-up) receives them once.
// Existing accounts never receive link credits.
import crypto from 'node:crypto';
import { BonusLink } from '../models/BonusLink.js';
import { User } from '../models/User.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { recordAudit } from './audit.service.js';
import { addCredits } from './credit.service.js';
import { NotFoundError } from '../utils/errors.js';
import { isObjectId } from '../utils/sanitize.js';

export const BONUS_CODE_SHAPE = /^[A-Za-z0-9_-]{6,64}$/;

export function signupUrl(code) {
  return `${env.CLIENT_URL.replace(/\/+$/, '')}/signup?bonus=${encodeURIComponent(code)}`;
}

/** Why a link cannot give credits right now, or null when it can. */
function unavailableReason(link, now = new Date()) {
  if (!link.enabled) return 'disabled';
  if (link.expiresAt && link.expiresAt <= now) return 'expired';
  if (link.maxUses !== null && link.maxUses !== undefined && link.uses >= link.maxUses) return 'used_up';
  return null;
}

export function toAdminBonusLinkDto(link) {
  const reason = unavailableReason(link);
  return {
    id: String(link._id),
    code: link.code,
    name: link.name,
    credits: link.credits,
    maxUses: link.maxUses ?? null,
    expiresAt: link.expiresAt || null,
    enabled: link.enabled,
    uses: link.uses || 0,
    creditsGranted: link.creditsGranted || 0,
    lastUsedAt: link.lastUsedAt || null,
    state: reason || 'active',
    url: signupUrl(link.code),
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
  };
}

export async function listBonusLinks() {
  const links = await BonusLink.find().sort({ createdAt: -1 }).limit(500).lean();
  return links.map(toAdminBonusLinkDto);
}

export async function createBonusLink(actor, { name, credits, maxUses = null, expiresAt = null }, req) {
  let link;
  for (let attempt = 0; attempt < 3 && !link; attempt += 1) {
    try {
      link = await BonusLink.create({
        code: crypto.randomBytes(9).toString('base64url'),
        name,
        credits,
        maxUses: maxUses ?? null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        enabled: true,
        createdBy: actor._id,
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
  }
  await recordAudit({
    req,
    actor,
    action: 'admin.bonus_link_created',
    area: 'admin',
    target: { type: 'bonus_link', id: link._id },
    summary: `Bonus link "${name}" created: ${credits} credits${maxUses ? `, up to ${maxUses} sign-ups` : ''}`,
    metadata: { credits, maxUses: maxUses ?? null, expiresAt: link.expiresAt },
  });
  return toAdminBonusLinkDto(link);
}

async function findLink(id) {
  if (!isObjectId(String(id))) throw new NotFoundError('Bonus link not found');
  const link = await BonusLink.findById(id);
  if (!link) throw new NotFoundError('Bonus link not found');
  return link;
}

export async function updateBonusLink(actor, id, changes, req) {
  const link = await findLink(id);
  const before = { enabled: link.enabled, name: link.name, maxUses: link.maxUses, expiresAt: link.expiresAt };
  if (changes.name !== undefined) link.name = changes.name;
  if (changes.enabled !== undefined) link.enabled = changes.enabled;
  if (changes.maxUses !== undefined) link.maxUses = changes.maxUses;
  if (changes.expiresAt !== undefined) link.expiresAt = changes.expiresAt ? new Date(changes.expiresAt) : null;
  await link.save();
  await recordAudit({
    req,
    actor,
    action: 'admin.bonus_link_updated',
    area: 'admin',
    target: { type: 'bonus_link', id: link._id },
    summary: `Bonus link "${link.name}" updated: ${Object.keys(changes).join(', ')}`.slice(0, 500),
    metadata: { before, changes },
  });
  return toAdminBonusLinkDto(link.toObject());
}

/** One link with the accounts that signed up through it. */
export async function getBonusLink(id) {
  const link = await findLink(id);
  const signups = await User.find({ bonusLinkId: link._id }).select('email name createdAt credits status').sort({ createdAt: -1 }).limit(100).lean();
  return {
    link: toAdminBonusLinkDto(link.toObject()),
    signups: signups.map((user) => ({
      id: String(user._id),
      email: user.email,
      name: user.name,
      credits: user.credits || 0,
      status: user.status,
      createdAt: user.createdAt,
    })),
  };
}

/** Public: what the sign-up page shows for ?bonus=<code>. Reveals no stats. */
export async function describeBonusCode(code) {
  if (!BONUS_CODE_SHAPE.test(String(code || ''))) return { valid: false, reason: 'not_found' };
  const link = await BonusLink.findOne({ code }).lean();
  if (!link) return { valid: false, reason: 'not_found' };
  const reason = unavailableReason(link);
  return reason ? { valid: false, reason } : { valid: true, credits: link.credits };
}

/**
 * Give a brand-new account the link's credits. Never blocks the sign-up: an
 * unknown, closed or used-up link simply gives nothing. The claim is one
 * atomic update, so maxUses holds even with simultaneous sign-ups.
 */
export async function claimBonusForNewUser(user, code, req) {
  if (!code || !BONUS_CODE_SHAPE.test(String(code))) return null;
  const now = new Date();
  const link = await BonusLink.findOneAndUpdate(
    {
      code,
      enabled: true,
      $and: [
        { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
        { $or: [{ maxUses: null }, { $expr: { $lt: ['$uses', '$maxUses'] } }] },
      ],
    },
    { $inc: { uses: 1 }, $set: { lastUsedAt: now } },
    { returnDocument: 'after' },
  ).lean();
  if (!link) {
    logger.info({ userId: String(user._id) }, 'Sign-up bonus code was not usable; no credits given');
    return null;
  }
  try {
    await User.updateOne({ _id: user._id }, { $set: { bonusLinkId: link._id } });
    await addCredits(user._id, link.credits, 'bonus_signup', { bonusLinkId: link._id, note: link.name });
    await BonusLink.updateOne({ _id: link._id }, { $inc: { creditsGranted: link.credits } });
  } catch (error) {
    // Give the slot back so the failure does not use up the link.
    await BonusLink.updateOne({ _id: link._id }, { $inc: { uses: -1 } });
    throw error;
  }
  await recordAudit({
    req,
    actor: user,
    action: 'credits.bonus_received',
    area: 'account',
    target: { type: 'bonus_link', id: link._id },
    summary: `Signed up with bonus link "${link.name}": ${link.credits} credits`,
    metadata: { credits: link.credits },
  });
  return { credits: link.credits };
}
