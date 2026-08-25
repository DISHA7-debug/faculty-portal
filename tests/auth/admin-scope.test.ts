import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Role } from '@prisma/client';

import { adminScope, scopedUserWhere } from '@/lib/auth/admin-scope';

import { IDS, deptAdminSession, facultySession, superAdminSession } from './factories';

/**
 * `scopedUserWhere` is what stands in for `assertOwnsProfileRow` on the admin panel's
 * `User` mutations (docs/SECURITY.md §1.5) — `User` carries no `profileId`, so the usual
 * helper structurally does not apply, and `scripts/check-ownership.mjs` says so explicitly
 * rather than silently passing. This is the manual verification that comment asks for,
 * written as a test that fails if the scoping logic regresses.
 */

describe('adminScope', () => {
  it('SUPER_ADMIN is GLOBAL, unconditionally', () => {
    assert.deepEqual(adminScope(superAdminSession()), { kind: 'GLOBAL' });
  });

  it('DEPT_ADMIN is DEPARTMENT, scoped to administersDepartmentId', () => {
    assert.deepEqual(adminScope(deptAdminSession()), {
      kind: 'DEPARTMENT',
      departmentId: IDS.deptCSE,
    });
  });

  it('REQUIREMENT: a DEPT_ADMIN with no assigned department is NONE, not GLOBAL', () => {
    const session = deptAdminSession({ administersDepartmentId: null });
    assert.deepEqual(adminScope(session), { kind: 'NONE' });
  });

  it('FACULTY is NONE', () => {
    assert.deepEqual(adminScope(facultySession()), { kind: 'NONE' });
  });
});

describe('scopedUserWhere', () => {
  it('SUPER_ADMIN gets an unrestricted where clause', () => {
    assert.deepEqual(scopedUserWhere(superAdminSession()), {});
  });

  it('DEPT_ADMIN gets role: FACULTY plus their department', () => {
    assert.deepEqual(scopedUserWhere(deptAdminSession()), {
      role: Role.FACULTY,
      profile: { is: { departmentId: IDS.deptCSE } },
    });
  });

  it('REQUIREMENT: role: FACULTY is always present for a DEPT_ADMIN — closes the "admin whose own profile shares my department" hole', () => {
    // docs/SECURITY.md §1.5: the seed data puts the SUPER_ADMIN account's own profile in
    // CSE. Without the role restriction, a CSE department admin's query would include
    // that account merely because the departments match.
    const where = scopedUserWhere(deptAdminSession());
    assert.equal(where && 'role' in where ? where.role : undefined, Role.FACULTY);
  });

  it('REQUIREMENT: a DEPT_ADMIN with no assigned department gets null, never {}', () => {
    // The distinction that matters: `null` tells the caller to skip the query. `{}` would
    // silently mean "everyone" — the exact failure mode `canAdminister` fails closed
    // against for the same field (lib/auth/rbac.ts).
    const session = deptAdminSession({ administersDepartmentId: null });
    assert.equal(scopedUserWhere(session), null);
  });

  it('FACULTY gets null', () => {
    assert.equal(scopedUserWhere(facultySession()), null);
  });

  it('two different departments produce two different where clauses', () => {
    const cse = scopedUserWhere(deptAdminSession({ administersDepartmentId: IDS.deptCSE }));
    const ece = scopedUserWhere(deptAdminSession({ administersDepartmentId: IDS.deptECE }));
    assert.notDeepEqual(cse, ece);
  });
});
