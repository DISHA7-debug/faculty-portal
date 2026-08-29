import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CustomSectionEditor, type CustomSectionData } from '@/components/dashboard/custom-section-editor';
import { requireSessionOrRedirect } from '@/lib/auth/session';
import { db } from '@/lib/db';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sectionSlug: string }>;
}): Promise<Metadata> {
  const { sectionSlug } = await params;
  const formatted = sectionSlug
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return { title: formatted };
}

export default async function CustomSectionPage({
  params,
}: {
  params: Promise<{ sectionSlug: string }>;
}) {
  const { sectionSlug } = await params;
  const session = await requireSessionOrRedirect(`/dashboard/custom/${sectionSlug}`);

  const rawSection = await db.customSection.findUnique({
    where: {
      profileId_slug: {
        profileId: session.profileId,
        slug: sectionSlug,
      },
    },
    include: {
      items: {
        orderBy: { sortOrder: 'asc' },
      },
    },
  });

  if (!rawSection) {
    notFound();
  }

  const section: CustomSectionData = {
    id: rawSection.id,
    title: rawSection.title,
    slug: rawSection.slug,
    columns: rawSection.columns,
    items: rawSection.items.map((item) => ({
      id: item.id,
      values: (item.values as Record<string, string>) || {},
      sortOrder: item.sortOrder,
    })),
  };

  return (
    <main className="px-gutter py-10 sm:py-14">
      <div className="max-w-4xl">
        <CustomSectionEditor section={section} />
      </div>
    </main>
  );
}
