import type { AccountStatus } from '@prisma/client';

/**
 * Admin-only status labels. Kept out of lib/labels.ts deliberately — that file centralises
 * labels shared between the dashboard editor and the PUBLIC profile page; AccountStatus
 * never reaches a public page, so it has no business in a module whose whole point is
 * "the editor and the public page must agree on wording".
 */
export const STATUS_LABELS: Record<AccountStatus, string> = {
  PENDING_VERIFICATION: 'Pending verification',
  PENDING_APPROVAL: 'Pending approval',
  ACTIVE: 'Active',
  REJECTED: 'Rejected',
  SUSPENDED: 'Suspended',
};

export const STATUS_TONE: Record<AccountStatus, 'neutral' | 'positive' | 'negative' | 'warning'> = {
  PENDING_VERIFICATION: 'neutral',
  PENDING_APPROVAL: 'warning',
  ACTIVE: 'positive',
  REJECTED: 'negative',
  SUSPENDED: 'negative',
};
