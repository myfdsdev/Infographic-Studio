import { z } from 'zod';
import { SCOPE_IDS } from '../mcp/scopes.js';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

export const connectionIdParam = z.strictObject({ id: objectId });

export const interactionParam = z.strictObject({
  uid: z.string().regex(/^[A-Za-z0-9_-]{10,64}$/, 'Invalid connection request'),
});

export const approveConsentBody = z.strictObject({
  scopes: z
    .array(z.enum(SCOPE_IDS, { error: 'Unknown permission' }))
    .min(1, 'Allow at least one permission, or choose Deny')
    .max(SCOPE_IDS.length),
});
