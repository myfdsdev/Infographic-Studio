import { z } from 'zod';
import { nameSchema, passwordSchema } from './auth.validator.js';

export const objectIdParam = z.strictObject({
  id: z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id'),
});

// Only the display name can be changed by the account owner. Email, role and
// status are not accepted here; sending them is a 400.
export const updateAccountBody = z.strictObject({
  name: nameSchema,
});

// The current password may only be left out when the account has none yet
// (made with Google); the service checks that.
export const changePasswordBody = z.strictObject({
  currentPassword: z.string().max(256).optional(),
  newPassword: passwordSchema,
});

// A password, or for accounts without one (made with Google) the account email.
export const deleteAccountBody = z
  .strictObject({
    password: z.string().min(1, 'Password is required').max(256).optional(),
    confirmEmail: z.string().max(254).optional(),
  })
  .refine((body) => body.password || body.confirmEmail, { message: 'Password is required', path: ['password'] });
