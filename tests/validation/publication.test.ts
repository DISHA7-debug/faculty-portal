import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { canonicaliseDoi, publicationSchema } from '@/lib/validation/publication';

const base = {
  type: 'JOURNAL' as const,
  title: 'A Scalable Approach to Fault-Tolerant Coordination',
  authors: 'Sharma A., Verma B.',
};

describe('canonicaliseDoi — empty becomes NULL, not empty string', () => {
  /**
   * The bug this prevents: an untouched DOI input submits ''. Postgres treats two empty
   * strings as EQUAL, so the second DOI-less publication violates
   * @@unique([profileId, doi]) and is reported as a duplicate DOI — on two papers that
   * have no DOI at all. Only NULL is distinct from itself.
   */
  it('maps every empty-ish input to null', () => {
    for (const input of ['', '   ', '\t\n', null, undefined]) {
      assert.equal(
        canonicaliseDoi(input),
        null,
        `${JSON.stringify(input)} must become null, never an empty string`,
      );
    }
  });

  it('REGRESSION: two DOI-less publications both parse to doi === null', () => {
    const first = publicationSchema.parse({ ...base, doi: '' });
    const second = publicationSchema.parse({
      ...base,
      title: 'A Completely Different Paper',
      doi: '',
    });

    assert.equal(first.doi, null);
    assert.equal(second.doi, null);
    // Two NULLs are distinct in Postgres, so the unique constraint does not fire.
    assert.ok(
      first.doi === null && second.doi === null,
      'both must be null so neither collides with the other',
    );
  });

  it('an omitted doi key is also null', () => {
    assert.equal(publicationSchema.parse({ ...base }).doi, null);
  });
});

describe('canonicaliseDoi — the same paper in any format collapses to one value', () => {
  const canonical = '10.1109/tpds.2024.123';

  const equivalents = [
    '10.1109/TPDS.2024.123',
    '10.1109/tpds.2024.123',
    'https://doi.org/10.1109/TPDS.2024.123',
    'http://doi.org/10.1109/TPDS.2024.123',
    'https://dx.doi.org/10.1109/TPDS.2024.123',
    'doi:10.1109/TPDS.2024.123',
    'DOI:10.1109/TPDS.2024.123',
    'doi: 10.1109/TPDS.2024.123',
    '  10.1109/TPDS.2024.123  ',
    '<10.1109/TPDS.2024.123>',
  ];

  for (const input of equivalents) {
    it(`normalises ${JSON.stringify(input)}`, () => {
      assert.equal(canonicaliseDoi(input), canonical);
    });
  }

  it('so all formats produce ONE value — which is what makes dedup work', () => {
    const distinct = new Set(equivalents.map((e) => canonicaliseDoi(e)));
    assert.equal(
      distinct.size,
      1,
      `expected one canonical value, got ${[...distinct].join(', ')}`,
    );
  });

  it('does not mangle a suffix that merely contains "doi"', () => {
    assert.equal(canonicaliseDoi('10.1000/doi-suffix'), '10.1000/doi-suffix');
  });
});

describe('publicationSchema', () => {
  it('rejects a malformed DOI with actionable wording', () => {
    const result = publicationSchema.safeParse({ ...base, doi: 'not-a-doi' });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.match(result.error.issues[0].message, /does not look like a DOI/i);
    }
  });

  it('accepts a full resolver URL and stores the bare DOI', () => {
    const parsed = publicationSchema.parse({
      ...base,
      doi: 'https://doi.org/10.1109/TPDS.2024.123',
    });
    assert.equal(parsed.doi, '10.1109/tpds.2024.123');
  });

  it('rejects unknown keys — no privilege smuggling', () => {
    for (const extra of [{ profileId: 'someone-else' }, { sortOrder: 0 }, { id: 'x' }]) {
      assert.equal(
        publicationSchema.safeParse({ ...base, ...extra }).success,
        false,
        `${JSON.stringify(extra)} must be rejected`,
      );
    }
  });

  it('normalises blank optional text to null rather than empty string', () => {
    const parsed = publicationSchema.parse({
      ...base,
      venue: '   ',
      publisher: '',
      volume: '',
    });
    assert.equal(parsed.venue, null);
    assert.equal(parsed.publisher, null);
    assert.equal(parsed.volume, null);
  });

  it('requires https for links', () => {
    assert.equal(
      publicationSchema.safeParse({ ...base, url: 'http://example.org/p' }).success,
      false,
    );
    assert.equal(
      publicationSchema.safeParse({ ...base, url: 'https://example.org/p' }).success,
      true,
    );
  });
});

// ---------------------------------------------------------------------------

import {
  defaultNameDisplay,
  displayStudentName,
  toInitials,
} from '@/lib/validation/sections';

describe('research student name display (docs/SECURITY.md §11.1)', () => {
  it('defaults a CURRENT student to initials — no consent was obtained', () => {
    assert.equal(defaultNameDisplay('ONGOING'), 'INITIALS');
  });

  it('defaults a DISCONTINUED supervision to initials — the most sensitive case', () => {
    assert.equal(defaultNameDisplay('DISCONTINUED'), 'INITIALS');
  });

  it('defaults a COMPLETED student to full name — the thesis already names them', () => {
    assert.equal(defaultNameDisplay('COMPLETED'), 'FULL_NAME');
  });

  it('renders initials correctly', () => {
    assert.equal(toInitials('Sunita Banerjee'), 'S. B.');
    assert.equal(toInitials('S. Banerjee'), 'S. B.');
    assert.equal(toInitials('Arvind Chandrasekaran Venkataraman'), 'A. C. V.');
    assert.equal(toInitials('  Priya   Nair '), 'P. N.');
  });

  it('never returns an empty string, which would render as a blank row', () => {
    assert.equal(toInitials(''), '—');
    assert.equal(toInitials('   '), '—');
    assert.equal(toInitials('123'), '—');
  });

  it('displayStudentName withholds the full name unless FULL_NAME is set', () => {
    const student = { studentName: 'Sunita Banerjee', nameDisplay: 'INITIALS' };
    assert.equal(displayStudentName(student), 'S. B.');
    assert.ok(
      !displayStudentName(student).includes('Sunita'),
      'the full given name must not leak through the initials path',
    );
    assert.equal(
      displayStudentName({ ...student, nameDisplay: 'FULL_NAME' }),
      'Sunita Banerjee',
    );
  });

  it('an unrecognised value falls back to initials, not to the full name', () => {
    // Fail closed: a future enum value must not accidentally publish a name.
    assert.equal(
      displayStudentName({ studentName: 'Sunita Banerjee', nameDisplay: 'SOMETHING_NEW' }),
      'S. B.',
    );
  });
});
