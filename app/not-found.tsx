import type { Metadata } from 'next';

import { NotFoundContent } from '@/components/public/not-found-content';
import { Providers } from '@/components/providers';
import { SiteFooter } from '@/components/public/site-footer';
import { SiteHeader } from '@/components/public/site-header';

/**
 * Root-level fallback — catches a URL that matches NO route at all (a typo above the
 * `/faculty`, `/departments`, `/dashboard` level). `app/(public)/not-found.tsx` handles
 * every `notFound()` called from WITHIN the public route tree and inherits its header and
 * footer from that segment's layout; nothing above the root layout provides either, so
 * this file supplies its own copies of the same components rather than a bare, unstyled
 * page. Same content either way — see the comment in `NotFoundContent`.
 */
export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: false },
};

export default function RootNotFound() {
  return (
    <Providers>
      <div className="flex min-h-dvh flex-col">
        <SiteHeader />
        <NotFoundContent />
        <SiteFooter />
      </div>
    </Providers>
  );
}
