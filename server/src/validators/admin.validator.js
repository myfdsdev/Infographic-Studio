import { z } from 'zod';
import { USER_ROLES, USER_STATUSES } from '../models/User.js';
import { AUDIT_AREAS } from '../models/AuditLog.js';

const page = z.coerce.number().int().min(1).max(10000).default(1);
const limit = z.coerce.number().int().min(1).max(100).default(25);
const search = z.string().trim().max(100).optional();

export const listUsersQuery = z.object({
  search,
  status: z.enum(['all', ...USER_STATUSES]).default('all'),
  role: z.enum(['all', ...USER_ROLES]).default('all'),
  page,
  limit,
});

export const updateUserBody = z
  .strictObject({
    role: z.enum(USER_ROLES).optional(),
    status: z.enum(USER_STATUSES).optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((value) => value.role !== undefined || value.status !== undefined, {
    message: 'Provide a role or a status to change',
  });

export const listAuditLogsQuery = z.object({
  search,
  area: z.enum(['all', ...AUDIT_AREAS]).default('all'),
  outcome: z.enum(['all', 'success', 'failure']).default('all'),
  page,
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const failuresQuery = z.object({ days: z.coerce.number().int().min(1).max(30).default(7) });

export const opsLogsQuery = z.object({
  search,
  level: z.enum(['all', 'warn', 'error', 'fatal']).default('all'),
  page,
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const connectionsQuery = z.object({
  search,
  status: z.enum(['all', 'active', 'revoked']).default('all'),
  page,
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const providerParam = z.strictObject({ provider: z.enum(['kie']) });

export const modelBody = z.strictObject({ model: z.string().trim().min(1).max(120), enabled: z.boolean() });

export const brandingImageParam = z.strictObject({ kind: z.enum(['logo', 'favicon']) });

// Multipart text fields of the branding image upload (only the file).
export const brandingUploadFields = z.strictObject({});

export const adminInfographicsQuery = z.object({
  search,
  status: z.enum(['all', 'active', 'queued', 'processing', 'completed', 'failed', 'cancelled']).default('all'),
  page,
  limit,
});

export const mcpMonitorQuery = z.object({ days: z.coerce.number().int().min(1).max(30).default(7) });
