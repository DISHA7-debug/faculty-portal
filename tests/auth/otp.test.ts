import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

process.env.AUTH_SECRET ??= 'test-secret-for-otp-hashing';

import {
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  formatOtpForDisplay,
  generateOtpCode,
  hashOtpCode,
  isWellFormedOtp,
  normaliseOtpInput,
  otpDigestsMatch,
} from '@/lib/auth/otp';

describe('generateOtpCode', () => {
  it('is always exactly 6 digits', () => {
    for (let i = 0; i < 500; i++) {
      const code = generateOtpCode();
      assert.equal(code.length, OTP_LENGTH);
      assert.match(code, /^\d{6}$/);
    }
  });

  it('can produce codes with leading zeros', () => {
    // If padding were missing, the space would be 9*10^5 rather than 10^6 and every code
    // starting 0 would be impossible — a 10% reduction for free.
    let sawLeadingZero = false;
    for (let i = 0; i < 5000 && !sawLeadingZero; i++) {
      if (generateOtpCode().startsWith('0')) sawLeadingZero = true;
    }
    assert.ok(sawLeadingZero, 'codes beginning with 0 must be reachable');
  });

  it('covers a wide spread of the space', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(generateOtpCode());
    // Collisions in 2000 draws from 10^6 are expected but should be rare.
    assert.ok(seen.size > 1900, `expected high variety, got ${seen.size} distinct`);
  });
});

describe('hashOtpCode', () => {
  it('is deterministic', () => {
    assert.equal(hashOtpCode('123456'), hashOtpCode('123456'));
  });

  it('never returns the code itself', () => {
    const digest = hashOtpCode('123456');
    assert.notEqual(digest, '123456');
    assert.equal(digest.length, 64);
    assert.match(digest, /^[0-9a-f]{64}$/, 'must be a hex digest');
    // A substring check would be near-vacuous here: a specific six-character sequence
    // appears in a random 64-char hex string with probability ~3e-6, so it passes whether
    // or not the implementation is correct. Asserting the SHAPE is what actually
    // distinguishes a digest from a passthrough.
  });

  it('differs from a plain SHA-256 of the code', async () => {
    // The whole point of keying with AUTH_SECRET: a database dump alone must not be
    // enough to recover a six-digit code by hashing all one million candidates.
    const { createHash } = await import('node:crypto');
    const plain = createHash('sha256').update('123456').digest('hex');
    assert.notEqual(hashOtpCode('123456'), plain);
  });

  it('different codes digest differently', () => {
    assert.notEqual(hashOtpCode('123456'), hashOtpCode('123457'));
  });
});

describe('otpDigestsMatch', () => {
  it('matches identical digests', () => {
    const d = hashOtpCode('123456');
    assert.equal(otpDigestsMatch(d, d), true);
  });

  it('rejects different digests', () => {
    assert.equal(otpDigestsMatch(hashOtpCode('123456'), hashOtpCode('654321')), false);
  });

  it('rejects malformed input rather than throwing', () => {
    assert.equal(otpDigestsMatch('', ''), false);
    assert.equal(otpDigestsMatch('abcd', ''), false);
  });
});

describe('input handling', () => {
  it('normalises spaces and dashes', () => {
    assert.equal(normaliseOtpInput('123 456'), '123456');
    assert.equal(normaliseOtpInput('123-456'), '123456');
    assert.equal(normaliseOtpInput('  123456 '), '123456');
  });

  it('recognises well-formed codes only', () => {
    assert.equal(isWellFormedOtp('123456'), true);
    assert.equal(isWellFormedOtp('000000'), true);
    assert.equal(isWellFormedOtp('12345'), false);
    assert.equal(isWellFormedOtp('1234567'), false);
    assert.equal(isWellFormedOtp('12345a'), false);
  });

  it('formats for transcription', () => {
    assert.equal(formatOtpForDisplay('123456'), '123 456');
  });
});

describe('attempt cap', () => {
  it('is small enough to matter', () => {
    // A 6-digit code is one of a million. With N attempts per code, guessing costs an
    // expected 10^6 / N code requests — and requests are themselves throttled. Raising
    // this materially weakens the scheme, since the code length is fixed.
    assert.ok(OTP_MAX_ATTEMPTS <= 5, 'the attempt cap IS the security parameter here');
  });
});
