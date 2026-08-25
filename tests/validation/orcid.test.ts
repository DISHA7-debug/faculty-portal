import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkOrcid, orcidCheckDigit, normaliseOrcid } from '@/lib/validation/orcid';

describe('orcidCheckDigit (ISO 7064 MOD 11-2)', () => {
  it('computes the published example', () => {
    // 0000-0002-1825-0097 is ORCID's own documented sample identifier.
    assert.equal(orcidCheckDigit('000000021825009'), '7');
  });

  it('produces X where the check value is 10', () => {
    // The case a naive `\d` pattern gets wrong: the final character is not a digit.
    const withX = '0000-0003-4567-890X';
    assert.equal(checkOrcid(withX).valid, true);
  });
});

describe('checkOrcid — rejects plausible-looking but WRONG identifiers', () => {
  /**
   * These are the point. Each passes a shape-only regex and would be published on a
   * public academic page as though authoritative, pointing visitors at the wrong
   * researcher or at nothing.
   */
  const valid = '0000-0002-1825-0097';

  it('accepts a genuine identifier', () => {
    const result = checkOrcid(valid);
    assert.equal(result.valid, true);
    if (result.valid) assert.equal(result.formatted, valid);
  });

  it('rejects all-zeros, which any regex accepts', () => {
    // The check digit for fifteen zeros is 1, so 0000-0000-0000-0000 fails the checksum
    // while passing every shape-based pattern.
    const result = checkOrcid('0000-0000-0000-0000');
    assert.equal(result.valid, false);
    if (!result.valid) assert.equal(result.reason, 'CHECKSUM');
  });

  it('rejects a single mistyped digit', () => {
    // 0097 -> 0098: one character, still sixteen digits, still hyphenated correctly.
    const result = checkOrcid('0000-0002-1825-0098');
    assert.equal(result.valid, false);
    if (!result.valid) assert.equal(result.reason, 'CHECKSUM');
  });

  it('rejects every single-digit substitution of a valid iD', () => {
    const compact = normaliseOrcid(valid);
    let rejected = 0;
    let tested = 0;
    for (let i = 0; i < 15; i++) {
      for (let d = 0; d <= 9; d++) {
        if (String(d) === compact[i]) continue;
        const mutated = compact.slice(0, i) + d + compact.slice(i + 1);
        tested++;
        if (!checkOrcid(mutated).valid) rejected++;
      }
    }
    assert.ok(tested > 100, 'sanity: the loop must actually run');
    assert.equal(rejected, tested, 'MOD 11-2 must catch every single-digit error');
  });

  it('rejects adjacent transpositions', () => {
    const compact = normaliseOrcid(valid);
    let tested = 0;
    let rejected = 0;
    for (let i = 0; i < 14; i++) {
      if (compact[i] === compact[i + 1]) continue; // swapping equal digits changes nothing
      const mutated =
        compact.slice(0, i) + compact[i + 1] + compact[i] + compact.slice(i + 2);
      tested++;
      if (!checkOrcid(mutated).valid) rejected++;
    }
    assert.ok(tested > 0, 'sanity: the loop must actually run');
    assert.equal(rejected, tested, 'transposing two digits must be caught');
  });

  it('rejects the wrong shape distinctly from a bad checksum', () => {
    const short = checkOrcid('0000-0002-1825-009');
    assert.equal(short.valid, false);
    if (!short.valid) assert.equal(short.reason, 'SHAPE');
  });
});

describe('checkOrcid — accepts what people paste', () => {
  const canonical = '0000-0002-1825-0097';
  for (const input of [
    '0000-0002-1825-0097',
    '0000000218250097',
    'https://orcid.org/0000-0002-1825-0097',
    'http://orcid.org/0000-0002-1825-0097',
    'https://www.orcid.org/0000-0002-1825-0097',
    '  0000-0002-1825-0097  ',
  ]) {
    it(`normalises ${JSON.stringify(input)}`, () => {
      const result = checkOrcid(input);
      assert.equal(result.valid, true);
      if (result.valid) assert.equal(result.formatted, canonical);
    });
  }
});
