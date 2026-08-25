import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { Role } from '@prisma/client';

import {
  ForbiddenError,
  SESSION_COOKIE,
  generateSessionToken,
  hashSessionToken,
  requireRole,
} from '@/lib/auth/session';

import { deptAdminSession, facultySession, superAdminSession } from './factories';

describe('session tokens', () => {
  it('generates 32 bytes of entropy', () => {
    const token = generateSessionToken();
    // base64url of 32 bytes decodes back to exactly 32.
    assert.equal(Buffer.from(token, 'base64url').length, 32);
  });

  it('is URL-safe, so it survives a cookie round trip unescaped', () => {
    for (let i = 0; i < 50; i++) {
      assert.match(generateSessionToken(), /^[A-Za-z0-9_-]+$/);
    }
  });

  it('does not repeat', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateSessionToken());
    assert.equal(seen.size, 1000);
  });

  it('hashes with SHA-256, and the hash is not the token', () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);

    assert.equal(hash, createHash('sha256').update(token).digest('hex'));
    assert.equal(hash.length, 64);
    assert.notEqual(hash, token);
    assert.ok(
      !hash.includes(token),
      'the stored value must not embed the raw token',
    );
  });

  it('hashing is deterministic, so lookup by hash works', () => {
    const token = generateSessionToken();
    assert.equal(hashSessionToken(token), hashSessionToken(token));
  });

  it('different tokens hash differently', () => {
    assert.notEqual(
      hashSessionToken(generateSessionToken()),
      hashSessionToken(generateSessionToken()),
    );
  });
});

describe('session cookie name', () => {
  it('uses the __Host- prefix', () => {
    assert.ok(
      SESSION_COOKIE.startsWith('__Host-'),
      'the prefix is what binds the cookie to this exact origin',
    );
  });
});

describe('requireRole', () => {
  it('passes a matching role through', () => {
    const session = facultySession();
    assert.equal(requireRole(session, [Role.FACULTY]), session);
  });

  it('throws ForbiddenError for a role not in the list', () => {
    assert.throws(
      () => requireRole(facultySession(), [Role.DEPT_ADMIN, Role.SUPER_ADMIN]),
      ForbiddenError,
    );
  });

  it('does NOT imply hierarchy — a SUPER_ADMIN is not implicitly FACULTY', () => {
    // Callers must list every acceptable role explicitly. Implicit hierarchy is how
    // an admin-only route quietly starts accepting faculty.
    assert.throws(
      () => requireRole(superAdminSession(), [Role.FACULTY]),
      ForbiddenError,
    );
    assert.equal(
      requireRole(superAdminSession(), [Role.FACULTY, Role.SUPER_ADMIN]).role,
      Role.SUPER_ADMIN,
    );
  });

  it('accepts an admin where both admin tiers are listed', () => {
    const session = deptAdminSession();
    assert.equal(
      requireRole(session, [Role.DEPT_ADMIN, Role.SUPER_ADMIN]),
      session,
    );
  });

  it('rejects an empty allow-list', () => {
    assert.throws(() => requireRole(superAdminSession(), []), ForbiddenError);
  });
});
