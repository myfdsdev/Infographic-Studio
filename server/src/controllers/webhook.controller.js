import { handleProviderCallback } from '../services/job.service.js';

// Always answer 200 with the same body so the endpoint reveals nothing about
// which jobs or tokens exist. The provider retries are harmless: handling is
// idempotent and every claim is verified against the provider itself.
export async function providerCallback(req, res) {
  const { provider, jobId, token } = req.validated.params;
  await handleProviderCallback(provider, jobId, token, req.body);
  res.json({ ok: true });
}
