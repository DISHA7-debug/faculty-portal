import Link from 'next/link';

import { listDepartments } from '@/lib/directory';

/**
 * Footer for every public page.
 *
 * Also the thing that occupies the trailing space under the last section of a profile.
 * `<ProfileSections>` gives its final section a viewport-height floor so that clicking the
 * last item in the section rail can actually scroll it to the top; without a footer that
 * space read as an unfinished page bottom.
 *
 * A Server Component, so the department list is a real query rather than a hardcoded array
 * that goes stale the first time somebody adds a department.
 */
export async function SiteFooter() {
  const departments = await listDepartments();

  return (
    <footer className="mt-auto border-t border-hairline bg-surface-sunken">
      <div className="px-gutter py-12">
        <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-3">
          <div>
            <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
              Faculty Portal
            </p>
            <p className="mt-3 max-w-[42ch] text-[0.85rem] leading-relaxed text-muted-foreground">
              Academic profiles maintained by the faculty themselves. Each page is edited and
              published by the person it describes.
            </p>
            <p className="mt-4 text-[0.85rem]">
              <Link
                href="/faculty"
                className="inline-block py-1 underline decoration-hairline underline-offset-4 transition-colors hover:decoration-current focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                Browse the directory
              </Link>
            </p>
          </div>

          <div>
            <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
              Departments
            </p>
            <ul className="mt-3 space-y-1.5">
              {departments.map((d) => (
                <li key={d.slug}>
                  <Link
                    href={`/departments/${d.slug}`}
                    className="inline-block py-1 text-[0.85rem] underline decoration-hairline underline-offset-4 transition-colors hover:decoration-current focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {d.name}
                  </Link>
                  <span className="ml-2 font-mono text-[0.7rem] tabular-nums text-muted-foreground">
                    {d.count}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
              Contact
            </p>
            <p className="mt-3 text-[0.85rem] leading-relaxed text-muted-foreground">
              Manipal University Jaipur<br />
              Dehmi Kalan, Jaipur<br />
              Rajasthan 303007
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
