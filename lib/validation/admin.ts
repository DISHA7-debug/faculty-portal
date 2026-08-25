import { Role } from '@prisma/client';
import { z } from 'zod';

/**
 * Admin-panel input schemas. `.strict()` throughout — same allow-list-by-construction
 * reasoning as `lib/validation/profile.ts`.
 */

export const rejectAccountSchema = z
  .object({
    userId: z.string().min(1),
    // A free-text reason, not a fixed enum: the applicant reads this verbatim in
    // rejectionEmail(), and the actual reasons ("wrong department", "could not verify
    // employment", "duplicate account") don't compress well into a short closed list.
    reason: z
      .string()
      .trim()
      .min(10, 'Give a reason of at least 10 characters — it is sent to the applicant.')
      .max(1000, 'Keep the reason under 1000 characters.'),
  })
  .strict();

export const changeRoleSchema = z
  .object({
    userId: z.string().min(1),
    role: z.enum(Role),
  })
  .strict();

export const targetUserSchema = z.object({ userId: z.string().min(1) }).strict();
