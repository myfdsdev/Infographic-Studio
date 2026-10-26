import { z } from 'zod';
import { PASSWORD_POLICY } from '../utils/password.js';

export const emailSchema = z
  .string({ error: 'Email is required' })
  .trim()
  .toLowerCase()
  .min(1, 'Email is required')
  .max(254, 'Email is too long')
  .email('Enter a valid email address');

export const passwordSchema = z
  .string({ error: 'Password is required' })
  .min(PASSWORD_POLICY.min, `Password must be at least ${PASSWORD_POLICY.min} characters`)
  .max(PASSWORD_POLICY.max, `Password must be ${PASSWORD_POLICY.max} characters or fewer`)
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/\d/, 'Password must contain at least one number');

export const nameSchema = z
  .string({ error: 'Name is required' })
  .trim()
  .min(2, 'Name is too short')
  .max(80, 'Name is too long');

// Strict objects: any extra field (role, status, isAdmin, ...) is rejected
// with 400 instead of being silently accepted.
export const signupBody = z.strictObject({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  // Optional bonus sign-up link code (?bonus=...). An unusable code never
  // blocks the sign-up; it just gives no credits.
  bonusCode: z.string().trim().max(64).optional(),
});

export const loginBody = z.strictObject({
  email: emailSchema,
  password: z.string({ error: 'Password is required' }).min(1, 'Password is required').max(256),
  remember: z.boolean().optional(),
});

export const forgotPasswordBody = z.strictObject({
  email: emailSchema,
});

export const resetPasswordBody = z.strictObject({
  token: z.string({ error: 'Reset token is required' }).min(20, 'Invalid reset token').max(200, 'Invalid reset token'),
  password: passwordSchema,
});
