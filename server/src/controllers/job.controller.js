import * as jobService from '../services/job.service.js';

export async function create(req, res) {
  const { kind, provider, model, idempotencyKey: bodyKey, ...params } = req.validated.body;
  const headerKey = req.get('Idempotency-Key');
  const idempotencyKey = bodyKey || (headerKey && /^[A-Za-z0-9_-]{8,100}$/.test(headerKey) ? headerKey : undefined);
  const { job, deduplicated } = await jobService.createJob(req.user, { kind, provider, model, params, idempotencyKey });
  res.status(deduplicated ? 200 : 202).json({ job: jobService.toJobDto(job), deduplicated });
}

export async function list(req, res) {
  res.json(await jobService.listJobs(req.user._id, req.validated.query));
}

export async function get(req, res) {
  res.json({ job: await jobService.getJob(req.user._id, req.params.id) });
}

export async function cancel(req, res) {
  res.json({ job: await jobService.cancelJob(req.user, req.params.id, { req }) });
}

export async function retry(req, res) {
  const job = await jobService.retryJob(req.user, req.params.id, {
    confirmDuplicateRisk: req.validated.body.confirmDuplicateRisk === true,
    req,
  });
  res.status(202).json({ job });
}
