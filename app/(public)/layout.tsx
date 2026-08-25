import { Providers } from '@/components/providers';
import { SiteFooter } from '@/components/public/site-footer';
import { SiteHeader } from '@/components/public/site-header';

/**
 * Public routes: landing page, faculty directory, department pages.
 *
 * No `headers()` call anywhere in this subtree, so these pages stay statically rendered
 * and keep the sub-1.5s LCP budget. The public CSP allows 'unsafe-inline' for scripts
 * precisely because a static document cannot carry a per-request nonce
 * (docs/SECURITY.md §7.1).
 *
 * The header and footer live HERE rather than in each page, so no public route can ship
 * without them. Before this, a visitor who arrived at a profile from a search result — the
 * majority of arrivals for any directory — had no link to anything else on the site.
 *
 * `min-h-dvh` plus `flex-col` and `mt-auto` on the footer keeps it at the bottom of the
 * viewport on short pages instead of floating halfway up under a sparse profile.
 */
export default function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <Providers>
      <div className="flex min-h-dvh flex-col">
        <SiteHeader />
        {children}
        <SiteFooter />
      </div>
    </Providers>
  );
}
