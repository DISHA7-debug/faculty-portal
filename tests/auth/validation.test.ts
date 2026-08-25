import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isAllowedEmailDomain,
  signupSchema,
  verifyCodeSchema,
} from '@/lib/validation/auth';
import { mailRequestDelayMs, progressiveDelayMs, stuffingDelayMs } from '@/lib/rate-limit';

describe('signupSchema', () => {
  const valid = {
    fullName: 'Dr. Anita Sharma',
    email: 'anita.sharma@faculty.example.invalid',
    departmentId: 'clh3k2j1x0000qwer1234abcd',
  };

  it('accepts a well-formed signup', () => {
    assert.equal(signupSchema.safeParse(valid).success, true);
  });

  it('REJECTS unknown keys — no privilege smuggling', () => {
    for (const extra of [
      { role: 'SUPER_ADMIN' },
      { status: 'ACTIVE' },
      { isPublished: true },
      { administersDepartmentId: 'dept_cse' },
      // There is no password any more; submitting one must be rejected, not ignored.
      { password: 'hunter2' },
    ]) {
      const result = signupSchema.safeParse({ ...valid, ...extra });
      assert.equal(
        result.success,
        false,
        `${JSON.stringify(extra)} must be rejected outright, not ignored`,
      );
    }
  });

  it('normalises email to lowercase and trims', () => {
    const parsed = signupSchema.parse({
      ...valid,
      email: '  ANITA.Sharma@Faculty.Example.Invalid  ',
    });
    assert.equal(parsed.email, 'anita.sharma@faculty.example.invalid');
  });

  it('rejects a malformed department id', () => {
    assert.equal(
      signupSchema.safeParse({ ...valid, departmentId: 'not-a-cuid' }).success,
      false,
    );
  });
});

describe('isAllowedEmailDomain', () => {
  const withEnv = (value: string | undefined, fn: () => void) => {
    const previous = process.env.ALLOWED_EMAIL_DOMAINS;
    if (value === undefined) delete process.env.ALLOWED_EMAIL_DOMAINS;
    else process.env.ALLOWED_EMAIL_DOMAINS = value;
    try {
      fn();
    } finally {
      if (previous === undefined) delete process.env.ALLOWED_EMAIL_DOMAINS;
      else process.env.ALLOWED_EMAIL_DOMAINS = previous;
    }
  };

  it('matches the configured domain', () => {
    withEnv('college.example', () => {
      assert.equal(isAllowedEmailDomain('a@college.example'), true);
      assert.equal(isAllowedEmailDomain('a@other.example'), false);
    });
  });

  it('matches subdomains of a configured domain', () => {
    withEnv('college.example', () => {
      assert.equal(isAllowedEmailDomain('a@faculty.college.example'), true);
    });
  });

  it('does NOT match a lookalike suffix', () => {
    withEnv('college.example', () => {
      // "evilcollege.example" ends with "college.example" as a STRING but is a
      // different domain. A naive endsWith() would let it through.
      assert.equal(isAllowedEmailDomain('a@evilcollege.example'), false);
    });
  });

  it('supports a comma-separated list', () => {
    withEnv('a.example, b.example', () => {
      assert.equal(isAllowedEmailDomain('x@a.example'), true);
      assert.equal(isAllowedEmailDomain('x@b.example'), true);
      assert.equal(isAllowedEmailDomain('x@c.example'), false);
    });
  });

  it('FAILS CLOSED when unset — unset config must not open registration', () => {
    withEnv(undefined, () => {
      assert.equal(isAllowedEmailDomain('anyone@anywhere.example'), false);
    });
  });
});

describe('progressiveDelayMs', () => {
  it('is free for the first two failures — people mistype', () => {
    assert.equal(progressiveDelayMs(1), 0);
    assert.equal(progressiveDelayMs(2), 0);
  });

  it('rises geometrically then caps', () => {
    assert.equal(progressiveDelayMs(3), 500);
    assert.equal(progressiveDelayMs(4), 1000);
    assert.equal(progressiveDelayMs(5), 2000);
    assert.equal(progressiveDelayMs(6), 4000);
    assert.equal(progressiveDelayMs(7), 8000);
    assert.equal(progressiveDelayMs(50), 8000, 'must cap, not grow unbounded');
  });
});

describe('stuffingDelayMs — escalating delay, never a hard lock', () => {
  it('is zero below the floor', () => {
    for (const n of [0, 1, 4, 7]) assert.equal(stuffingDelayMs(n), 0);
  });

  it('escalates per doubling of distinct sources', () => {
    assert.equal(stuffingDelayMs(8), 1000);
    assert.equal(stuffingDelayMs(16), 2000);
    assert.equal(stuffingDelayMs(32), 4000);
    assert.equal(stuffingDelayMs(64), 8000);
  });

  it('CAPS — an unbounded delay would be a hard lock in disguise', () => {
    // The whole reason the hard lock was removed is that a cliff can be pushed over
    // cheaply. A delay that grows without limit reintroduces exactly that.
    assert.equal(stuffingDelayMs(1_000), 10_000);
    assert.equal(stuffingDelayMs(1_000_000), 10_000);
  });

  it('always leaves the real owner a way in', () => {
    assert.ok(
      stuffingDelayMs(Number.MAX_SAFE_INTEGER) <= 10_000,
      'the legitimate user must never be locked out, only slowed',
    );
  });
});

describe('mailRequestDelayMs — soft throttle on an address the attacker knows', () => {
  it('is free for the first three, so a real resend is not punished', () => {
    for (const n of [1, 2, 3]) assert.equal(mailRequestDelayMs(n), 0);
  });

  it('escalates then caps', () => {
    assert.equal(mailRequestDelayMs(4), 1000);
    assert.equal(mailRequestDelayMs(5), 2000);
    assert.equal(mailRequestDelayMs(8), 15000);
    assert.equal(mailRequestDelayMs(100), 15000);
  });

  it('never blocks — onboarding cannot be denied by a third party', () => {
    assert.ok(
      Number.isFinite(mailRequestDelayMs(10_000)),
      'a finite delay means the address owner can always eventually proceed',
    );
  });
});

describe('verifyCodeSchema', () => {
  const email = 'a@faculty.example.invalid';

  it('accepts a plain 6-digit code', () => {
    const parsed = verifyCodeSchema.parse({ email, code: '123456' });
    assert.equal(parsed.code, '123456');
  });

  it('accepts what people actually type', () => {
    // A form that rejects "123 456" blames the user for its own strictness — the code is
    // displayed spaced in the email precisely because it is easier to transcribe.
    for (const input of ['123 456', '123-456', ' 123456 ', '12 34 56']) {
      const parsed = verifyCodeSchema.parse({ email, code: input });
      assert.equal(parsed.code, '123456', `${JSON.stringify(input)} should normalise`);
    }
  });

  it('preserves leading zeros — 000123 is a valid code', () => {
    // Trimming these to a number would shrink the code space by 10%.
    assert.equal(verifyCodeSchema.parse({ email, code: '000123' }).code, '000123');
  });

  it('rejects anything that is not exactly six digits', () => {
    for (const bad of ['12345', '1234567', 'abcdef', '12345a', '']) {
      assert.equal(
        verifyCodeSchema.safeParse({ email, code: bad }).success,
        false,
        `${JSON.stringify(bad)} must be rejected`,
      );
    }
  });

  it('rejects unknown keys', () => {
    assert.equal(
      verifyCodeSchema.safeParse({ email, code: '123456', role: 'SUPER_ADMIN' }).success,
      false,
    );
  });
});
