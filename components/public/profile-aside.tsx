import type { PublicProfile } from '@/lib/public-profile';
import { getPublicUrl } from '@/lib/storage';

/**
 * Contact and scholarly identifiers.
 *
 * ── The visibility flags land here ──────────────────────────────────────────────────────
 *
 * `showMobile` and `showAltEmail` have existed since the schema was written and have had no
 * effect on anything until this component. This is the read path they were for.
 *
 * They are already applied by the query (lib/public-profile.ts), which does not return the
 * columns at all when the flag is off — so the check below is a null check, not a policy
 * decision. That ordering is deliberate: policy in one place, near the data; presentation
 * here. A future component that forgets to check gets `null`, not a leak.
 *
 * The primary college email is NOT optional. It is the institutional address, it is already
 * in the college directory, and a faculty page a visitor cannot write to is not doing its
 * job. The two flags cover the two genuinely personal fields — a mobile number and a
 * private mailbox.
 */

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-hairline py-3 first:border-t-0 first:pt-0">
      <dt className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </dt>
      {/*
        `overflow-wrap: anywhere`, not just `break-words` (= break-word).
        break-word only breaks a long token if the line has no other wrap opportunity, and
        critically it is EXCLUDED from min-content size calculations in flex/grid layouts —
        so a flex/grid ancestor still sizes its track to the token's full width and the
        column overflows anyway. `anywhere` participates in min-content sizing, which is
        the difference that actually stops `firstname.lastname@department.institution.edu`
        from pushing this 15rem rail wide enough to scroll the page sideways on a phone.
      */}
      <dd className="mt-1 text-[0.9rem] leading-snug break-words [overflow-wrap:anywhere]">
        {children}
      </dd>
    </div>
  );
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      // noopener: the opened page must not get a handle on window.opener. noreferrer
      // additionally withholds which faculty page the visitor came from.
      rel="noopener noreferrer external"
      /*
        `py-1` on an INLINE anchor. Vertical padding does not change inline layout, but it
        does enlarge the hit rectangle — which takes these from ~17px to ~25px tall and over
        the 24px pointer-target floor (WCAG 2.2 SC 2.5.8). `inline-block` would have done
        the same and cost more: an inline-block shrink-to-fit box will not wrap a long email
        address inside a 15rem column, and the address would overflow instead.
      */
      className="inline py-1 underline decoration-hairline underline-offset-4 transition-colors hover:decoration-current focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {children}
    </a>
  );
}

const IDENTIFIERS: Array<{
  key: 'orcid' | 'scopusId' | 'googleScholarId' | 'researcherId';
  label: string;
  href: (v: string) => string | null;
}> = [
  { key: 'orcid', label: 'ORCID', href: (v) => `https://orcid.org/${v}` },
  {
    key: 'googleScholarId',
    label: 'Google Scholar',
    href: (v) => `https://scholar.google.com/citations?user=${encodeURIComponent(v)}`,
  },
  {
    key: 'scopusId',
    label: 'Scopus',
    href: (v) =>
      `https://www.scopus.com/authid/detail.uri?authorId=${encodeURIComponent(v)}`,
  },
  {
    key: 'researcherId',
    label: 'ResearcherID',
    href: (v) => `https://www.webofscience.com/wos/author/record/${encodeURIComponent(v)}`,
  },
];

export function ProfileAside({ profile }: { profile: PublicProfile }) {
  const { contact } = profile;
  const identifiers = IDENTIFIERS.filter((i) => profile[i.key]);
  const hasWeb = Boolean(profile.personalPageUrl || profile.linkedinUrl);

  return (
    <aside
      aria-label="Contact and identifiers"
      className="lg:sticky lg:top-24 lg:self-start"
    >
      <dl className="text-foreground">
        <Row label="Email">
          <ExternalLink href={`mailto:${contact.email}`}>{contact.email}</ExternalLink>
        </Row>

        {contact.altEmail ? (
          <Row label="Alternative email">
            <ExternalLink href={`mailto:${contact.altEmail}`}>
              {contact.altEmail}
            </ExternalLink>
          </Row>
        ) : null}

        {contact.mobile ? (
          <Row label="Mobile">
            <ExternalLink href={`tel:${contact.mobile.replace(/\s/g, '')}`}>
              {contact.mobile}
            </ExternalLink>
          </Row>
        ) : null}

        {contact.phoneExt ? (
          <Row label="Phone / Ext">
            <ExternalLink href={`tel:${contact.phoneExt.replace(/\s/g, '')}`}>
              {contact.phoneExt}
            </ExternalLink>
          </Row>
        ) : null}

        {profile.officeNo ? <Row label="Office">{profile.officeNo}</Row> : null}

        {identifiers.length > 0 ? (
          <Row label="Identifiers">
            <ul className="space-y-1.5">
              {identifiers.map((i) => {
                const value = profile[i.key] as string;
                const href = i.href(value);
                return (
                  <li key={i.key}>
                    <span className="text-muted-foreground">{i.label} </span>
                    {href ? (
                      <ExternalLink href={href}>{value}</ExternalLink>
                    ) : (
                      <span>{value}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </Row>
        ) : null}

        {hasWeb ? (
          <Row label="Web">
            <ul className="space-y-1.5">
              {profile.personalPageUrl ? (
                <li>
                  <ExternalLink href={profile.personalPageUrl}>Personal page</ExternalLink>
                </li>
              ) : null}
              {profile.linkedinUrl ? (
                <li>
                  <ExternalLink href={profile.linkedinUrl}>LinkedIn</ExternalLink>
                </li>
              ) : null}
            </ul>
          </Row>
        ) : null}

        {profile.cvKey ? (
          <Row label="Curriculum vitae">
            {/* Served from the storage origin as a download, never rendered inline by us —
                see the note in lib/uploads.ts on why PDFs are stored unmodified. */}
            <ExternalLink href={getPublicUrl(profile.cvKey)}>Download CV (PDF)</ExternalLink>
          </Row>
        ) : null}
      </dl>
    </aside>
  );
}
