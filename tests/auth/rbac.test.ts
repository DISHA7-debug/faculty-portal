import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AccountStatus } from '@prisma/client';

import {
  assertCanAdminister,
  assertCanPublish,
  assertCanPublishProfile,
  canAdminister,
  canEditOwnProfile,
  canPublish,
  isAdmin,
  isSuperAdmin,
} from '@/lib/auth/rbac';
import { ForbiddenError } from '@/lib/auth/session';

import {
  IDS,
  deptAdminSession,
  facultySession,
  isNotFoundError,
  superAdminSession,
} from './factories';

describe('canAdminister', () => {
  it('REQUIREMENT: a DEPT_ADMIN fails for a profile in another department', () => {
    const session = deptAdminSession(); // administers CSE
    assert.equal(
      canAdminister(session, { departmentId: IDS.deptECE }),
      false,
      'a CSE admin must not administer an ECE profile',
    );
  });

  it('a DEPT_ADMIN passes for a profile in the department they administer', () => {
    const session = deptAdminSession();
    assert.equal(canAdminister(session, { departmentId: IDS.deptCSE }), true);
  });

  it('REQUIREMENT: a SUPER_ADMIN passes for any department', () => {
    const session = superAdminSession();
    assert.equal(canAdminister(session, { departmentId: IDS.deptCSE }), true);
    assert.equal(canAdminister(session, { departmentId: IDS.deptECE }), true);
    assert.equal(canAdminister(session, { departmentId: null }), true);
  });

  it('a plain FACULTY never administers anything', () => {
    const session = facultySession();
    assert.equal(canAdminister(session, { departmentId: IDS.deptCSE }), false);
    assert.equal(canAdminister(session, { departmentId: session.departmentId }), false);
  });

  describe('scope comes from administersDepartmentId, never the editable profile field', () => {
    it('denies when only the admin’s OWN profile department matches', () => {
      // The escalation: a CSE-scoped admin edits their profile into ECE and tries
      // to administer ECE. Their granted scope is unchanged, so this must fail.
      const session = deptAdminSession({
        departmentId: IDS.deptECE, // self-edited, untrusted
        administersDepartmentId: IDS.deptCSE, // granted, SUPER_ADMIN-only
      });

      assert.equal(
        canAdminister(session, { departmentId: IDS.deptECE }),
        false,
        'matching the self-edited profile department must grant nothing',
      );
      assert.equal(
        canAdminister(session, { departmentId: IDS.deptCSE }),
        true,
        'the granted scope still applies',
      );
    });

    it('denies a DEPT_ADMIN with no granted department at all', () => {
      const session = deptAdminSession({ administersDepartmentId: null });
      assert.equal(canAdminister(session, { departmentId: IDS.deptCSE }), false);
    });

    it('null scope must not match a null department', () => {
      const session = deptAdminSession({ administersDepartmentId: null });
      assert.equal(
        canAdminister(session, { departmentId: null }),
        false,
        'null === null must never read as a match',
      );
    });
  });
});

describe('assertCanAdminister', () => {
  it('throws ForbiddenError out of department', () => {
    assert.throws(
      () => assertCanAdminister(deptAdminSession(), { departmentId: IDS.deptECE }),
      ForbiddenError,
    );
  });

  it('returns the session in department', () => {
    const session = deptAdminSession();
    assert.equal(
      assertCanAdminister(session, { departmentId: IDS.deptCSE }),
      session,
    );
  });
});

describe('role predicates', () => {
  it('classifies each role', () => {
    assert.equal(isSuperAdmin(superAdminSession()), true);
    assert.equal(isSuperAdmin(deptAdminSession()), false);
    assert.equal(isAdmin(deptAdminSession()), true);
    assert.equal(isAdmin(facultySession()), false);
  });
});

describe('publish gating (PENDING_APPROVAL may edit, may never publish)', () => {
  const pending = () =>
    facultySession({ status: AccountStatus.PENDING_APPROVAL });

  it('an ACTIVE faculty member may publish', () => {
    assert.equal(canPublish(facultySession()), true);
  });

  it('a PENDING_APPROVAL faculty member may NOT publish', () => {
    assert.equal(canPublish(pending()), false);
  });

  it('a PENDING_APPROVAL faculty member MAY still edit', () => {
    assert.equal(
      canEditOwnProfile(pending()),
      true,
      'the approval gate blocks publication, not the dashboard',
    );
  });

  it('assertCanPublish throws for PENDING_APPROVAL, with an actionable message', () => {
    assert.throws(
      () => assertCanPublish(pending()),
      (error: unknown) => {
        assert.ok(error instanceof ForbiddenError);
        assert.match(error.message, /awaiting administrator approval/i);
        return true;
      },
    );
  });

  it('blocks publish for every non-ACTIVE status, including admins', () => {
    for (const status of [
      AccountStatus.PENDING_APPROVAL,
      AccountStatus.PENDING_VERIFICATION,
      AccountStatus.SUSPENDED,
      AccountStatus.REJECTED,
    ]) {
      assert.equal(
        canPublish(facultySession({ status })),
        false,
        `${status} must not publish`,
      );
      assert.equal(
        canPublish(superAdminSession({ status })),
        false,
        `a SUPER_ADMIN with status ${status} must not publish either`,
      );
    }
  });

  it('assertCanPublish returns the session when ACTIVE', () => {
    const session = facultySession();
    assert.equal(assertCanPublish(session), session);
  });
});

describe('assertCanPublishProfile', () => {
  it('allows publishing your own profile', () => {
    const session = facultySession();
    assert.ok(
      assertCanPublishProfile(session, {
        id: IDS.facultyProfile,
        departmentId: IDS.deptCSE,
      }),
    );
  });

  it('a colleague in the same department may NOT publish your profile — 404, not 403', () => {
    // Sharing a department is not a relationship that grants authority.
    const session = facultySession();
    assert.throws(
      () =>
        assertCanPublishProfile(session, {
          id: IDS.otherFacultyProfile,
          departmentId: IDS.deptCSE,
        }),
      (error: unknown) => {
        assert.ok(
          isNotFoundError(error),
          'cross-profile denial must 404 like every other ownership check',
        );
        return true;
      },
    );
  });

  it('a DEPT_ADMIN may publish a profile in their department', () => {
    assert.ok(
      assertCanPublishProfile(deptAdminSession(), {
        id: IDS.otherFacultyProfile,
        departmentId: IDS.deptCSE,
      }),
    );
  });

  it('a DEPT_ADMIN may not publish outside their department — 404, not 403', () => {
    assert.throws(
      () =>
        assertCanPublishProfile(deptAdminSession(), {
          id: IDS.otherFacultyProfile,
          departmentId: IDS.deptECE,
        }),
      (error: unknown) => {
        assert.ok(isNotFoundError(error), 'out-of-scope profile must 404');
        return true;
      },
    );
  });

  it('account-status rejection stays a ForbiddenError, not a 404', () => {
    // The caller demonstrably administers this profile; the refusal is about THEIR
    // account state, so they get told why rather than a misleading 404.
    const session = deptAdminSession({
      status: AccountStatus.PENDING_APPROVAL,
    });
    assert.throws(
      () =>
        assertCanPublishProfile(session, {
          id: IDS.otherFacultyProfile,
          departmentId: IDS.deptCSE,
        }),
      ForbiddenError,
    );
  });
});
