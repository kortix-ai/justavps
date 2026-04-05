import { z } from 'zod';

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

const emailField = z
  .string()
  .email('Invalid email address')
  .transform((value) => value.toLowerCase().trim());

const passwordField = z
  .string()
  .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters`)
  .max(PASSWORD_MAX, 'Password is too long');

const tokenField = z.string().min(16, 'Invalid token').max(256, 'Invalid token');

export const RegisterSchema = z.object({
  email: emailField,
  password: passwordField,
  name: z.string().min(1).max(128).optional(),
});

export const VerifyEmailSchema = z.object({
  token: tokenField,
});

export const ResendVerificationSchema = z.object({
  email: emailField,
});

export const ForgotPasswordSchema = z.object({
  email: emailField,
});

export const ResetPasswordSchema = z.object({
  token: tokenField,
  password: passwordField,
});
