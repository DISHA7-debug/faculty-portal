import { z } from 'zod';

/**
 * Zod schemas for auth input. Server-side validation — client validation is UX only
 * (docs/SECURITY.md §4).
 *
 * Every object is `.strict()`, so an unknown key is a rejection rather than something
 * quietly ignored. That is what stops `{ email, password, role: 'SUPER_ADMIN' }` from
 * being partially honoured if a handler ever spreads the parsed result.
 */

/**
 * Email, normalised to lowercase and trimmed at parse time so every downstream
 * comparison, uniqueness check, and rate-limit key sees the same string.
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254) // RFC 5321 maximum
  .pipe(z.email('Enter a valid email address.'));

/**
 * Checks an email against ALLOWED_EMAIL_DOMAINS.
 *
 * This is necessary but nowhere near sufficient: students hold addresses on the same
 * domain, which is exactly why the admin approval gate exists and cannot be disabled
 * (docs/SECURITY.md §2.1). Domain matching decides who may *register*, never who may
 * *publish*.
 */
export function isAllowedEmailDomain(email: string): boolean {
  const configured = process.env.ALLOWED_EMAIL_DOMAINS?.trim();
  if (!configured) return false; // fail closed: unset config must not open registration

  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return false;

  return configured
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
    .some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));
}

export const signupSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, 'Enter your full name.')
      .max(120, 'Name must be at most 120 characters.'),
    email: emailSchema,
    departmentId: z.cuid('Select a department.'),
  })
  .strict();

export type SignupInput = z.infer<typeof signupSchema>;

/** Step one of sign-in: the address a code is sent to. */
export const requestCodeSchema = z.object({ email: emailSchema }).strict();

/**
 * Step two: the code itself.
 *
 * Spaces and dashes are stripped before validation because people transcribe a code from
 * an email by hand and a form that rejects "123 456" is a form that blames the user for
 * its own strictness.
 */
export const verifyCodeSchema = z
  .object({
    email: emailSchema,
    code: z
      .string()
      .transform((value) => value.replace(/[\s-]/g, '').trim())
      .pipe(
        z
          .string()
          .regex(/^\d{6}$/, 'Enter the 6-digit code from your email.'),
      ),
  })
  .strict();
