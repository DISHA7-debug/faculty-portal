import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { DirectoryEmpty, FacultyGrid } from '@/components/public/faculty-grid';
import { getDepartment, listDepartmentSlugs, listFaculty } from '@/lib/directory';

/**
 * A department's faculty.
 *
 * Statically rendered, unlike the directory: there are no query parameters here. A
 * department is a fixed, small set that changes when somebody publishes or is suspended,
 * which the revalidation interval covers.
 *
 * Deliberately NOT a redirect to `/faculty?department=…`. This page is what a department
 * links to from its own site, what a search engine indexes, and what goes on printed
 * material — it deserves a stable URL, a real title, and its own description, none of which
 * a query string gets.
 */

export const revalidate = 300;
export const dynamicParams = true;

export async function generateStaticParams() {
  return (await listDepartmentSlugs()).map((slug) => ({ slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const department = await getDepartment(slug);
  if (!department) return { title: 'Department not found' };

  return {
    title: department.name,
    description:
      department.about ??
      `Faculty of the Department of ${department.name} (${department.code}).`,
    alternates: { canonical: `/departments/${department.slug}` },
  };
}

export default async function DepartmentPage({ params }: Props) {
  const { slug } = await params;
  const department = await getDepartment(slug);
  if (!department) notFound();

  // No pagination: the largest department in a college of this size is well under one page.
  // If that stops being true, the fix is a link through to the filtered directory, which
  // already paginates — not a second pagination implementation here.
  const { entries, total } = await listFaculty({ department: slug });

  return (
    <main className="px-gutter py-12 sm:py-16">
      <div className="mx-auto max-w-5xl">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
          Department · {department.code}
        </p>
        <h1 className="mt-4 font-display text-[clamp(2.1rem,5.5vw,3.1rem)] leading-[1.06] tracking-[-0.02em] text-balance">
          {department.name}
        </h1>

        {department.about ? (
          <p className="measure mt-5 text-[1rem] leading-[1.75] text-pretty">
            {department.about}
          </p>
        ) : null}

        <p className="mt-6 text-[0.9rem] text-muted-foreground">
          {total === 0
            ? 'No published profiles yet.'
            : `${total} ${total === 1 ? 'profile' : 'profiles'}`}
          {' · '}
          <Link
            href={`/faculty?department=${department.slug}`}
            className="inline py-1 underline decoration-hairline underline-offset-4 transition-colors hover:decoration-current focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            search within this department
          </Link>
        </p>

        <div className="mt-10">
          {entries.length > 0 ? (
            <FacultyGrid entries={entries} />
          ) : (
            /*
              An empty department is normal early on, and it is NOT the same as a broken
              page. Faculty members publish individually, so a department can exist with
              nobody visible in it for weeks.
            */
            <DirectoryEmpty q="" hasFilters={false} />
          )}
        </div>
      </div>
    </main>
  );
}
