import { z } from 'zod';
import { PROVIDER_KEYS } from '../providers/providerRegistry.js';
import { JOB_STATUSES, JOB_KINDS } from '../models/GenerationJob.js';

// Public URLs only. Internal "asset://" references are created by the server
// and must never be accepted from a client.
const url = z
  .string()
  .trim()
  .max(2048)
  .regex(/^https:\/\/\S+$/i, 'Must be a public https URL');

// Provider-neutral generation parameters. Model-specific rules (allowed
// ratios, resolutions, reference counts) are enforced by the provider adapter.
export const createJobBody = z.strictObject({
  kind: z.enum(JOB_KINDS),
  provider: z.enum(PROVIDER_KEYS).default('kie'),
  model: z.string().trim().min(1).max(100),
  prompt: z.string().max(20000).optional(),
  aspectRatio: z.string().trim().max(20).optional(),
  resolution: z.string().trim().max(20).optional(),
  outputFormat: z.string().trim().max(10).optional(),
  referenceImageUrls: z.array(url).max(10).optional(),
  idempotencyKey: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,100}$/, 'Idempotency key must be 8-100 letters, digits, - or _')
    .optional(),
});

export const listJobsQuery = z.object({
  status: z.enum(['all', ...JOB_STATUSES]).default('all'),
  kind: z.enum(['all', ...JOB_KINDS]).default('all'),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const adminListJobsQuery = listJobsQuery.extend({
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const retryJobBody = z.strictObject({
  confirmDuplicateRisk: z.boolean().optional(),
});

export const providerParam = z.strictObject({
  provider: z.enum(PROVIDER_KEYS),
});

export const saveCredentialBody = z.strictObject({
  apiKey: z.string({ error: 'API key is required' }).trim().min(1, 'API key is required').max(300),
});

export const webhookParams = z.strictObject({
  provider: z.string().max(20),
  jobId: z.string().max(40),
  token: z.string().max(200),
});
