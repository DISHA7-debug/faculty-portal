'use client';

import {
  RepeatableSection,
  type FieldConfig,
} from '@/components/dashboard/repeatable-section';
import { COURSE_LEVEL_LABELS as LEVEL_LABELS, labelOf } from '@/lib/labels';
import { courseSchema } from '@/lib/validation/sections';

import {
  createCourseAction,
  deleteCourseAction,
  reorderCourseAction,
  updateCourseAction,
  type CourseRow,
} from './actions';

/**
 * Course's configuration for the generic section component.
 *
 * Entity-specific only: field list, summary line, and which server actions to call.
 * The component itself knows nothing about courses taught.
 */

const FIELDS: FieldConfig[] = [
  { name: 'name', label: 'Course name', type: 'text', required: true },
  { name: 'code', label: 'Code', type: 'text', span: 1, placeholder: 'CS301' },
  {
    name: 'level',
    label: 'Level',
    type: 'select',
    required: true,
    span: 1,
    options: Object.entries(LEVEL_LABELS).map(([value, label]) => ({
      value,
      label,
    })),
  },
  {
    name: 'semester',
    label: 'Semester',
    type: 'text',
    span: 1,
    placeholder: 'Odd',
  },
  { name: 'year', label: 'Year', type: 'number', span: 1 },
];

function summaryLine(row: CourseRow) {
  return (
    <>
      <p className="text-[0.7rem] font-mono uppercase tracking-[0.14em] text-muted-foreground">
        {labelOf(LEVEL_LABELS, row.level)}
      </p>
      <p className="mt-1.5 text-[1.05rem] leading-snug font-medium">
        {row.code ? (
          <span className="font-mono text-[0.95rem]">{row.code} </span>
        ) : null}
        {row.name}
      </p>
      <p className="mt-1 text-[0.9rem] text-muted-foreground">
        {[row.semester, row.year?.toString()].filter(Boolean).join(' · ')}
      </p>
    </>
  );
}

export function CourseSection({ initialItems }: { initialItems: CourseRow[] }) {
  return (
    <RepeatableSection<CourseRow>
      initialItems={initialItems}
      noun={{ singular: 'Course', plural: 'Courses taught' }}
      description="One entry per offering — the same course across several years is several entries."
      fields={FIELDS}
      schema={courseSchema}
      toFormValues={(row) => ({
        name: row.name,
        code: row.code ?? '',
        level: row.level,
        semester: row.semester ?? '',
        year: row.year?.toString() ?? '',
      })}
      renderSummary={summaryLine}
      onCreate={createCourseAction}
      onUpdate={updateCourseAction}
      onDelete={deleteCourseAction}
      onReorder={reorderCourseAction}
    />
  );
}
