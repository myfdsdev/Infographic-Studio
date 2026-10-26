// Platform credits, the platform provider key and bonus sign-up links.
import * as credits from '../services/credit.service.js';
import * as bonusLinks from '../services/bonusLink.service.js';

// ---- signed-in user
export async function myCredits(req, res) {
  const [access, transactions] = await Promise.all([
    credits.generationAccess(req.user),
    credits.listTransactions(req.user._id, { limit: 20 }),
  ]);
  res.json({ ...access, transactions });
}

// ---- public (sign-up page)
export async function describeBonus(req, res) {
  res.json(await bonusLinks.describeBonusCode(req.params.code));
}

// ---- admin: platform key
export async function getPlatformKey(_req, res) {
  res.json({ key: await credits.getPlatformKeyStatus() });
}

export async function savePlatformKey(req, res) {
  res.json(await credits.savePlatformKey(req.user, req.validated.body.apiKey, req));
}

export async function testPlatformKey(req, res) {
  res.json(await credits.testPlatformKey(req.user, req));
}

export async function deletePlatformKey(req, res) {
  await credits.deletePlatformKey(req.user, req);
  res.json({ key: await credits.getPlatformKeyStatus() });
}

// ---- admin: users' credits
export async function adjustUserCredits(req, res) {
  const { amount, note } = req.validated.body;
  res.json(await credits.adjustCredits(req.user, req.validated.params.id, amount, note, req));
}

export async function userTransactions(req, res) {
  res.json({ transactions: await credits.listTransactions(req.validated.params.id, { limit: 50 }) });
}

// ---- admin: bonus links
export async function listBonusLinks(_req, res) {
  res.json({ links: await bonusLinks.listBonusLinks() });
}

export async function createBonusLink(req, res) {
  res.status(201).json({ link: await bonusLinks.createBonusLink(req.user, req.validated.body, req) });
}

export async function getBonusLink(req, res) {
  res.json(await bonusLinks.getBonusLink(req.validated.params.id));
}

export async function updateBonusLink(req, res) {
  res.json({ link: await bonusLinks.updateBonusLink(req.user, req.validated.params.id, req.validated.body, req) });
}
