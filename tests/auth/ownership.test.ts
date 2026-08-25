import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assertOwnsProfile,
  assertOwnsProfileRow,
  ownsProfileRow,
} from '@/lib/auth/ownership';

import {
  IDS,
  deptAdminSession,
  facultySession,
  isNotFoundError,
  ownedRow,
  superAdminSession,
} from './factories';

/** Asserts the call rejects with Next's notFound() signal — never a 403. */
async function assertNotFound(fn: () => Promise<unknown>, message: string) {
  await assert.rejects(
    fn,
    (error: unknown) => {
      assert.ok(
        isNotFoundError(error),
        `${message} — expected a notFound() rejection, got: ${String(error)}`,
      );
      return true;
    },
    message,
  );
}

describe('assertOwnsProfileRow', () => {
  describe('FACULTY', () => {
    it('allows a faculty member to act on their own row', async () => {
      const session = facultySession();
      const row = ownedRow(IDS.facultyProfile);

      const result = await assertOwnsProfileRow(row, session);
      assert.equal(result, row, 'the row itself should be returned');
    });

    it('REQUIREMENT: 404s when a FACULTY passes a foreign row ID', async () => {
      const session = facultySession();
      // The IDOR attempt: a real row, belonging to somebody else.
      const foreignRow = ownedRow(IDS.otherFacultyProfile);

      await assertNotFound(
        () => assertOwnsProfileRow(foreignRow, session),
        'a faculty member must not reach another faculty member’s row',
      );
    });

    it('404s on a missing row, indistinguishably from a foreign one', async () => {
      const session = facultySession();
      await assertNotFound(
        () => assertOwnsProfileRow(null, session),
        'a missing row must 404',
      );
    });

    it('does not leak existence: missing and foreign rows fail identically', async () => {
      const session = facultySession();

      const missing = await assertOwnsProfileRow(null, session).catch((e) => e);
      const foreign = await assertOwnsProfileRow(
        ownedRow(IDS.otherFacultyProfile),
        session,
      ).catch((e) => e);

      assert.equal(
        (missing as { digest?: string }).digest,
        (foreign as { digest?: string }).digest,
        'a 403-vs-404 difference would confirm the row exists',
      );
    });
  });

  describe('DEPT_ADMIN', () => {
    it('allows acting on a row in the department they administer', async () => {
      const session = deptAdminSession(); // administers CSE
      const row = ownedRow(IDS.otherFacultyProfile);

      const result = await assertOwnsProfileRow(row, session, {
        loadOwnerDepartmentId: async () => IDS.deptCSE,
      });
      assert.equal(result, row);
    });

    it('404s on a row in a department they do not administer', async () => {
      const session = deptAdminSession(); // administers CSE
      const row = ownedRow(IDS.otherFacultyProfile);

      await assertNotFound(
        () =>
          assertOwnsProfileRow(row, session, {
            loadOwnerDepartmentId: async () => IDS.deptECE,
          }),
        'a CSE admin must not reach an ECE row',
      );
    });

    it('DERIVES the department itself when the caller omits it', async () => {
      const session = deptAdminSession(); // administers CSE
      const row = ownedRow(IDS.otherFacultyProfile);

      // No ownerDepartmentId passed: the helper loads it from the owning profile,
      // so ~40 Sprint 3 call sites cannot get this wrong by omission.
      const result = await assertOwnsProfileRow(row, session, {
        loadOwnerDepartmentId: async (profileId) => {
          assert.equal(profileId, IDS.otherFacultyProfile, 'loads the OWNER’s department');
          return IDS.deptCSE;
        },
      });
      assert.equal(result, row);
    });

    it('denies via the derived department when out of scope', async () => {
      const session = deptAdminSession(); // administers CSE
      await assertNotFound(
        () =>
          assertOwnsProfileRow(ownedRow(IDS.otherFacultyProfile), session, {
            loadOwnerDepartmentId: async () => IDS.deptECE,
          }),
        'derivation must deny an out-of-scope row, not just fill a blank',
      );
    });

    it('fails CLOSED when the department cannot be resolved', async () => {
      const session = deptAdminSession();
      await assertNotFound(
        () =>
          assertOwnsProfileRow(ownedRow(IDS.otherFacultyProfile), session, {
            loadOwnerDepartmentId: async () => null, // deleted / dangling profile
          }),
        'an unresolvable department must deny',
      );
    });

    it('still reaches their own row without a department argument', async () => {
      const session = deptAdminSession();
      const own = ownedRow(IDS.deptAdminProfile);

      const result = await assertOwnsProfileRow(own, session);
      assert.equal(result, own);
    });

    it('ignores their own editable profile department when scoping', async () => {
      // The escalation attempt: edit your own profile into ECE and try to act there.
      const session = deptAdminSession({
        departmentId: IDS.deptECE, // self-edited
        administersDepartmentId: IDS.deptCSE, // granted scope, SUPER_ADMIN-only
      });

      await assertNotFound(
        () =>
          assertOwnsProfileRow(ownedRow(IDS.otherFacultyProfile), session, {
            loadOwnerDepartmentId: async () => IDS.deptECE,
          }),
        'editing your own profile department must not widen admin scope',
      );
    });
  });

  describe('SUPER_ADMIN', () => {
    it('REQUIREMENT: passes for a foreign row', async () => {
      const session = superAdminSession();
      const row = ownedRow(IDS.otherFacultyProfile);

      const result = await assertOwnsProfileRow(row, session);
      assert.equal(result, row);
    });

    it('passes across departments without a department argument', async () => {
      const session = superAdminSession();
      const row = ownedRow(IDS.otherFacultyProfile);

      const result = await assertOwnsProfileRow(row, session, {
        loadOwnerDepartmentId: async () => IDS.deptECE,
      });
      assert.equal(result, row);
    });

    it('still 404s on a genuinely missing row', async () => {
      await assertNotFound(
        () => assertOwnsProfileRow(null, superAdminSession()),
        'even a super admin cannot act on a row that does not exist',
      );
    });
  });
});

describe('ownsProfileRow (non-throwing, for rendering decisions)', () => {
  it('mirrors assertOwnsProfileRow without throwing', async () => {
    assert.equal(
      await ownsProfileRow(ownedRow(IDS.facultyProfile), facultySession()),
      true,
    );
    assert.equal(
      await ownsProfileRow(ownedRow(IDS.otherFacultyProfile), facultySession()),
      false,
    );
    assert.equal(await ownsProfileRow(null, superAdminSession()), false);
    assert.equal(
      await ownsProfileRow(ownedRow(IDS.otherFacultyProfile), superAdminSession()),
      true,
    );
  });

  it('derives the department for a DEPT_ADMIN', async () => {
    assert.equal(
      await ownsProfileRow(ownedRow(IDS.otherFacultyProfile), deptAdminSession(), {
        loadOwnerDepartmentId: async () => IDS.deptCSE,
      }),
      true,
    );
    assert.equal(
      await ownsProfileRow(ownedRow(IDS.otherFacultyProfile), deptAdminSession(), {
        loadOwnerDepartmentId: async () => IDS.deptECE,
      }),
      false,
    );
  });
});

describe('assertOwnsProfile (Profile rows, keyed by id)', () => {
  it('allows the owner', async () => {
    const profile = { id: IDS.facultyProfile, departmentId: IDS.deptCSE };
    const result = await assertOwnsProfile(profile, facultySession());
    assert.equal(result, profile);
  });

  it('404s for another faculty member’s profile', async () => {
    const profile = { id: IDS.otherFacultyProfile, departmentId: IDS.deptCSE };
    await assertNotFound(
      () => assertOwnsProfile(profile, facultySession()),
      'faculty must not edit a colleague’s profile, same department or not',
    );
  });

  it('allows a DEPT_ADMIN within their department', async () => {
    const profile = { id: IDS.otherFacultyProfile, departmentId: IDS.deptCSE };
    const result = await assertOwnsProfile(profile, deptAdminSession());
    assert.equal(result, profile);
  });

  it('404s for a DEPT_ADMIN outside their department', async () => {
    const profile = { id: IDS.otherFacultyProfile, departmentId: IDS.deptECE };
    await assertNotFound(
      () => assertOwnsProfile(profile, deptAdminSession()),
      'a CSE admin must not edit an ECE profile',
    );
  });
});
