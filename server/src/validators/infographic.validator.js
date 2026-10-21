import { z } from 'zod';
import { INFOGRAPHIC_STYLES, INFOGRAPHIC_RATIOS } from '../models/Infographic.js';
import { TOPIC_MIN, TOPIC_MAX } from '../services/infographicPrompt.js';

const idempotencyKey = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,100}$/, 'Idempotency key must be 8-100 letters, digits, - or _')
  .optional();

export const createInfographicBody = z.strictObject({
  topic: z
    .string({ error: 'Describe the topic of your infographic' })
    .trim()
    .min(TOPIC_MIN, `Describe the topic in at least ${TOPIC_MIN} characters`)
    .max(TOPIC_MAX, `Keep the topic under ${TOPIC_MAX} characters`),
  style: z.enum(INFOGRAPHIC_STYLES, { error: `Choose a style: ${INFOGRAPHIC_STYLES.join(', ')}` }),
  aspectRatio: z.enum(INFOGRAPHIC_RATIOS, { error: `Choose an aspect ratio: ${INFOGRAPHIC_RATIOS.join(', ')}` }),
  idempotencyKey,
});

export const regenerateBody = z.strictObject({ idempotencyKey });

export const listInfographicsQuery = z.object({
  status: z.enum(['all', 'active', 'queued', 'processing', 'completed', 'failed', 'cancelled']).default('all'),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});

export const infographicIdParam = z.strictObject({
  id: z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid infographic id'),
});

export const imageQuery = z.object({ download: z.enum(['0', '1']).optional() });
