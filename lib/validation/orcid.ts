/**
 * ORCID validation, including the check digit.
 *
 * A regex confirms sixteen digits in the right shape. It does NOT confirm the identifier
 * belongs to anybody: `0000-0000-0000-0000` passes any pattern check and resolves to no
 * researcher at all.
 *
 * That matters more here than in most forms, because the value is rendered on a PUBLIC
 * academic profile beside the person's name, where it reads as authoritative. A visitor
 * who clicks a wrong-but-plausible ORCID lands on somebody else's publication record, or
 * on nothing. A mistyped identifier that looks official is worse than an empty field —
 * an empty field is honestly empty.
 *
 * The check digit catches every single-digit error and every adjacent transposition,
 * which between them are almost all the mistakes people actually make when copying
 * sixteen digits by hand.
 */

/**
 * ISO 7064 MOD 11-2, as specified by ORCID.
 *
 * Accumulate `(total + digit) * 2` across the first fifteen digits, then the check value
 * is `(12 - (total mod 11)) mod 11`, with 10 written as `X`.
 */
export function orcidCheckDigit(first15: string): string {
  let total = 0;
  for (const character of first15) {
    total = (total + Number(character)) * 2;
  }
  const remainder = total % 11;
  const result = (12 - remainder) % 11;
  return result === 10 ? 'X' : String(result);
}

/** Strips the URL form and any separators, leaving 16 characters. */
export function normaliseOrcid(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\/(www\.)?orcid\.org\//i, '')
    .replace(/[\s-]/g, '')
    .toUpperCase();
}

export type OrcidCheck =
  | { valid: true; formatted: string }
  | { valid: false; reason: 'SHAPE' | 'CHECKSUM' };

/**
 * Validates and formats an ORCID.
 *
 * Accepts what people paste: a bare identifier, one with hyphens, or a full orcid.org URL.
 * Returns the canonical hyphenated form.
 */
export function checkOrcid(input: string): OrcidCheck {
  const compact = normaliseOrcid(input);

  // 15 digits then a digit or X.
  if (!/^\d{15}[\dX]$/.test(compact)) return { valid: false, reason: 'SHAPE' };

  if (orcidCheckDigit(compact.slice(0, 15)) !== compact[15]) {
    return { valid: false, reason: 'CHECKSUM' };
  }

  const formatted = [
    compact.slice(0, 4),
    compact.slice(4, 8),
    compact.slice(8, 12),
    compact.slice(12, 16),
  ].join('-');

  return { valid: true, formatted };
}
