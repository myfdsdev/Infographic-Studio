import * as adminService from '../services/admin.service.js';
import * as jobService from '../services/job.service.js';
import { startActingAs, toActingAsDto } from '../services/actAs.service.js';
import { toPublicUser } from '../utils/sanitize.js';

export async function listUsers(req, res) {
  res.json(await adminService.listUsers(req.validated.query));
}

export async function getUser(req, res) {
  res.json(await adminService.getUserDetails(req.validated.params.id));
}

export async function updateUser(req, res) {
  res.json(await adminService.updateUser(req.user, req.validated.params.id, req.validated.body, req));
}

export async function actAsUser(req, res) {
  const { user, startedAt, expiresAt } = await startActingAs(req.user, req.authSession, req.validated.params.id, req);
  res.json({ user: toPublicUser(user), actingAs: toActingAsDto(req.user, { startedAt, expiresAt }) });
}

export async function listAuditLogs(req, res) {
  res.json(await adminService.listAuditLogs(req.validated.query));
}

export async function listJobs(req, res) {
  res.json(await jobService.adminListJobs(req.validated.query));
}

export async function retryJob(req, res) {
  const job = await jobService.retryJob(req.user, req.params.id, {
    admin: true,
    confirmDuplicateRisk: req.validated.body.confirmDuplicateRisk === true,
    req,
  });
  res.status(202).json({ job });
}

export async function cancelJob(req, res) {
  res.json({ job: await jobService.cancelJob(req.user, req.params.id, { admin: true, req }) });
}
