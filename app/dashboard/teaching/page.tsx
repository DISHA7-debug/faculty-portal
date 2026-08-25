import type { Metadata } from 'next';

import { listCourse } from './actions';
import { CourseSection } from './courses-section';

export const metadata: Metadata = { title: 'Teaching' };

export default async function CoursePage() {
  const items = await listCourse();

  return (
    <main className="px-gutter py-10 sm:py-14">
      <div className="max-w-3xl">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
          Profile
        </p>
        <h1 className="mt-5 text-[2.5rem] leading-[1.08] tracking-[-0.015em]">
          Teaching
        </h1>
        <div className="mt-12">
          <CourseSection initialItems={items} />
        </div>
      </div>
    </main>
  );
}
