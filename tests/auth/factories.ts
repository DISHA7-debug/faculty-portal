import { AccountStatus, Role } from '@prisma/client';

import type { AppSession } from '@/lib/auth/session';

/** Stable IDs so assertions read clearly. */
export const IDS = {
  deptCSE: 'dept_cse',
  deptECE: 'dept_ece',

  facultyUser: 'user_faculty',
  facultyProfile: 'profile_faculty',

  otherFacultyUser: 'user_other',
  otherFacultyProfile: 'profile_other',

  deptAdminUser: 'user_deptadmin',
  deptAdminProfile: 'profile_deptadmin',

  superAdminUser: 'user_superadmin',
  superAdminProfile: 'profile_superadmin',
} as const;

function base(): Omit<AppSession, 'userId' | 'profileId' | 'role'> {
  return {
    sessionId: 'sess_test',
    status: AccountStatus.ACTIVE,
    departmentId: IDS.deptCSE,
    administersDepartmentId: null,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  };
}

/** A plain faculty member in CSE. */
export function facultySession(overrides: Partial<AppSession> = {}): AppSession {
  return {
    ...base(),
    userId: IDS.facultyUser,
    profileId: IDS.facultyProfile,
    role: Role.FACULTY,
    ...overrides,
  };
}

/**
 * A department admin who administers CSE.
 *
 * Note the deliberate mismatch available via overrides: `departmentId` (their own
 * profile's department, user-editable) is distinct from `administersDepartmentId`
 * (their granted scope). Tests use that gap to prove scope is never read from the
 * editable field.
 */
export function deptAdminSession(
  overrides: Partial<AppSession> = {},
): AppSession {
  return {
    ...base(),
    userId: IDS.deptAdminUser,
    profileId: IDS.deptAdminProfile,
    role: Role.DEPT_ADMIN,
    administersDepartmentId: IDS.deptCSE,
    ...overrides,
  };
}

export function superAdminSession(
  overrides: Partial<AppSession> = {},
): AppSession {
  return {
    ...base(),
    userId: IDS.superAdminUser,
    profileId: IDS.superAdminProfile,
    role: Role.SUPER_ADMIN,
    ...overrides,
  };
}

/** A publication-like row owned by the given profile. */
export function ownedRow(profileId: string) {
  return { id: 'row_1', profileId, title: 'A paper' };
}

/**
 * True if the error is Next's notFound() signal.
 * Next 16 uses `NEXT_HTTP_ERROR_FALLBACK;404`; earlier versions used `NEXT_NOT_FOUND`.
 */
export function isNotFoundError(error: unknown): boolean {
  const digest = (error as { digest?: unknown })?.digest;
  if (typeof digest !== 'string') return false;
  return digest === 'NEXT_NOT_FOUND' || digest.includes('404');
}
