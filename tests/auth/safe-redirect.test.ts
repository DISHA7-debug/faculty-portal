import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_NEXT, safeNextPath } from '@/lib/safe-redirect';

/**
 * An open redirect on a login page is a phishing primitive: the victim sees the real
 * domain and a real certificate right up until the bounce. Every case below is a way
 * a `startsWith('/')` check gets defeated.
 */
describe('safeNextPath — hostile input', () => {
  const hostile: Array<[string, string]> = [
    ['//evil.example', 'protocol-relative: resolves to https://evil.example'],
    ['///evil.example', 'triple slash, same effect'],
    ['/\\evil.example', 'backslash: browsers normalise \\ to /'],
    ['/\\/evil.example', 'mixed slash and backslash'],
    ['\\\\evil.example', 'UNC-style, no leading slash'],
    ['https://evil.example', 'absolute URL'],
    ['http://evil.example', 'absolute URL, plaintext'],
    ['//evil.example/path?a=b', 'protocol-relative with a path'],
    ['javascript:alert(1)', 'script scheme'],
    ['/javascript:alert(1)', 'script scheme behind a slash'],
    ['data:text/html,<script>alert(1)</script>', 'data URL'],
    ['%2f%2fevil.example', 'encoded protocol-relative'],
    ['/%2fevil.example', 'encoded second slash'],
    ['/%2F%2Fevil.example', 'encoded, uppercase'],
    ['%252f%252fevil.example', 'double-encoded'],
    ['/%5cevil.example', 'encoded backslash'],
    ['/\tjavascript:alert(1)', 'tab before scheme'],
    ['/\njavascript:alert(1)', 'newline before scheme'],
    [' //evil.example', 'leading space hides the protocol-relative form'],
    ['/../../etc/passwd', 'traversal'],
    ['/dashboard/../../evil', 'traversal after a legitimate prefix'],
    ['mailto:someone@evil.example', 'non-http scheme'],
    ['evil.example', 'bare host, no leading slash'],
    ['', 'empty'],
  ];

  for (const [input, why] of hostile) {
    it(`rejects ${JSON.stringify(input)} — ${why}`, () => {
      assert.equal(
        safeNextPath(input),
        DEFAULT_NEXT,
        `must fall back rather than redirect off-origin`,
      );
    });
  }

  it('rejects an over-long value', () => {
    assert.equal(safeNextPath(`/${'a'.repeat(600)}`), DEFAULT_NEXT);
  });

  it('rejects malformed percent-encoding rather than throwing', () => {
    assert.equal(safeNextPath('/%zz'), DEFAULT_NEXT);
    assert.equal(safeNextPath('/%'), DEFAULT_NEXT);
  });

  it('rejects non-string input', () => {
    assert.equal(safeNextPath(null), DEFAULT_NEXT);
    assert.equal(safeNextPath(undefined), DEFAULT_NEXT);
    assert.equal(safeNextPath(42 as unknown as string), DEFAULT_NEXT);
  });
});

describe('safeNextPath — auth pages', () => {
  // Bouncing a just-authenticated user back to /login looks like a failed sign-in.
  for (const path of [
    '/login',
    '/signup',
    '/verify',
    '/forgot-password',
    '/reset-password',
    '/check-email',
    '/logout',
    '/login?next=%2Fdashboard',
    '/verify/resend',
  ]) {
    it(`rejects ${path}`, () => {
      assert.equal(safeNextPath(path), DEFAULT_NEXT);
    });
  }

  it('does not reject a path that merely starts with the same letters', () => {
    assert.equal(safeNextPath('/logins-report'), '/logins-report');
    assert.equal(safeNextPath('/verification-guide'), '/verification-guide');
  });
});

describe('safeNextPath — legitimate values', () => {
  const allowed = [
    '/dashboard',
    '/dashboard/publications',
    '/dashboard/publications?sort=year',
    '/admin/approvals',
    '/faculty/anita-sharma',
    '/dashboard/profile#contact',
    '/dashboard?at=10:30', // colon in the QUERY is fine; only the path is restricted
    '/',
  ];

  for (const path of allowed) {
    it(`allows ${path}`, () => {
      assert.equal(safeNextPath(path), path);
    });
  }

  it('honours a custom fallback', () => {
    assert.equal(safeNextPath('//evil.example', '/admin'), '/admin');
  });

  it('returns the RAW value, so the caller redirects to exactly what was validated', () => {
    // Returning the decoded form would mean validating one string and redirecting to
    // another.
    const encoded = '/dashboard/publications%3Fsort%3Dyear';
    assert.equal(safeNextPath(encoded), encoded);
  });
});
