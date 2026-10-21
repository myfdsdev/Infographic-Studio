import * as connectionService from '../services/mcpConnection.service.js';

export async function info(_req, res) {
  res.json(await connectionService.mcpInfo());
}

export async function listConnections(req, res) {
  res.json(await connectionService.listConnections(req.user));
}

export async function revokeConnection(req, res) {
  res.json({ connection: await connectionService.revokeConnection(req.user, req.validated.params.id, req) });
}

export async function activity(req, res) {
  res.json(await connectionService.listActivity(req.user));
}

export async function getConsent(req, res) {
  res.json(await connectionService.getConsentRequest(req.user, req.validated.params.uid));
}

export async function approveConsent(req, res) {
  res.json(await connectionService.approveConsent(req.user, req.validated.params.uid, req.validated.body, req));
}

export async function denyConsent(req, res) {
  res.json(await connectionService.denyConsent(req.user, req.validated.params.uid, req));
}
