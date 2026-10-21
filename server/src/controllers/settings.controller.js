import * as authService from '../services/auth.service.js';
import * as credentialService from '../services/credential.service.js';
import * as googleAuth from '../services/googleAuth.service.js';
import { listProviders } from '../providers/providerRegistry.js';

export async function getAccount(req, res) {
  res.json({ user: authService.publicUser(req.user), signIn: await googleAuth.signInMethods(req.user) });
}

export async function disconnectGoogle(req, res) {
  res.json({ ok: true, signIn: await googleAuth.disconnectGoogle(req.user, req) });
}

export async function updateAccount(req, res) {
  const user = await authService.updateProfile(req.user, req.validated.body, req);
  res.json({ user: authService.publicUser(user) });
}

export async function changePassword(req, res) {
  const result = await authService.changePassword(req.user, req.authSession, req.validated.body, req);
  res.json({ ok: true, ...result });
}

export async function listSessions(req, res) {
  const items = await authService.listSessions(req.user._id, req.authSession?._id);
  res.json({ items });
}

export async function revokeSession(req, res) {
  await authService.revokeOwnSession(req.user, req.validated.params.id, req);
  if (String(req.validated.params.id) === String(req.authSession?._id)) authService.clearSessionCookie(res);
  res.json({ ok: true });
}

export async function revokeOtherSessions(req, res) {
  const revoked = await authService.revokeOtherSessions(req.user, req.authSession, req);
  res.json({ ok: true, revoked });
}

export async function deleteAccount(req, res) {
  await authService.deleteAccount(req.user, req.validated.body, req);
  authService.clearSessionCookie(res);
  res.json({ ok: true });
}

// ---- providers and API keys -------------------------------------------------
export async function providers(_req, res) {
  res.json({ items: listProviders() });
}

export async function listCredentials(req, res) {
  const items = await credentialService.listCredentials(req.user._id);
  // An administrator acting as this user never sees the key's last digits.
  if (req.impersonator) items.forEach((item) => (item.last4 = ''));
  res.json({ items });
}

export async function saveCredential(req, res) {
  const result = await credentialService.saveCredential(req.user, req.validated.params.provider, req.validated.body.apiKey, req);
  res.json(result);
}

export async function verifyCredential(req, res) {
  res.json(await credentialService.verifyCredential(req.user, req.validated.params.provider, req));
}

export async function deleteCredential(req, res) {
  await credentialService.deleteCredential(req.user, req.validated.params.provider, req);
  res.json({ ok: true });
}
