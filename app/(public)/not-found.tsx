import type { Metadata } from 'next';

import { NotFoundContent } from '@/components/public/not-found-content';

/**
 * Reached by every `notFound()` call inside the public route tree — an unpublished or
 * nonexistent faculty slug, an unknown department. `app/(public)/layout.tsx` already
 * supplies the header and footer for this segment, so only the body renders here.
 */
export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: false },
};

export default function PublicNotFound() {
  return <NotFoundContent />;
}
