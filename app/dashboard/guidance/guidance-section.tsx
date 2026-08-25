'use client';

import {
  RepeatableSection,
  type FieldConfig,
} from '@/components/dashboard/repeatable-section';
import {
  GUIDANCE_DEGREE_LABELS as DEGREE_LABELS,
  GUIDANCE_NAME_DISPLAY_LABELS as NAME_DISPLAY_LABELS,
  GUIDANCE_STATUS_LABELS as STATUS_LABELS,
  labelOf,
} from '@/lib/labels';
import { displayStudentName, guidanceSchema } from '@/lib/validation/sections';

import {
  createGuidanceAction,
  deleteGuidanceAction,
  reorderGuidanceAction,
  updateGuidanceAction,
  type GuidanceRow,
} from './actions';

/**
 * Guidance's configuration for the generic section component.
 *
 * Entity-specific only: field list, summary line, and which server actions to call.
 * The component itself knows nothing about research guidance.
 */

const FIELDS: FieldConfig[] = [
  {
    name: 'studentName',
    label: 'Student name',
    type: 'text',
    required: true,
    span: 1,
  },
  {
    name: 'degree',
    label: 'Degree',
    type: 'select',
    required: true,
    span: 1,
    options: Object.entries(DEGREE_LABELS).map(([value, label]) => ({
      value,
      label,
    })),
  },
  {
    name: 'nameDisplay',
    label: 'Show name publicly as',
    type: 'select',
    span: 1,
    hint: 'Current students default to initials — they have not agreed to be listed.',
    options: Object.entries(NAME_DISPLAY_LABELS).map(([value, label]) => ({
      value,
      label,
    })),
  },
  { name: 'topic', label: 'Topic', type: 'text' },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    span: 1,
    options: Object.entries(STATUS_LABELS).map(([value, label]) => ({
      value,
      label,
    })),
  },
  { name: 'startYear', label: 'Start year', type: 'number', span: 1 },
  { name: 'awardYear', label: 'Award year', type: 'number', span: 1 },
  { name: 'coGuide', label: 'Co-guide', type: 'text', span: 1 },
];

function summaryLine(row: GuidanceRow) {
  const years =
    row.startYear && row.awardYear
      ? `${row.startYear}–${row.awardYear}`
      : (row.startYear?.toString() ?? row.awardYear?.toString() ?? null);
  return (
    <>
      <p className="text-[0.7rem] font-mono uppercase tracking-[0.14em] text-muted-foreground">
        {labelOf(DEGREE_LABELS, row.degree)} ·{' '}
        {labelOf(STATUS_LABELS, row.status)}
      </p>
      {/*
        The editor shows what the PUBLIC page will show, with the private full name beside
        it. Displaying only the stored name here would make it impossible to notice that a
        current student is about to be named in full.
      */}
      <p className="mt-1.5 text-[1.05rem] leading-snug font-medium">
        {displayStudentName(row)}
        {row.nameDisplay === 'INITIALS' ? (
          <span className="ml-2 text-[0.85rem] font-normal text-muted-foreground">
            (shown publicly · {row.studentName} in private)
          </span>
        ) : null}
      </p>
      {row.topic ? (
        <p className="measure mt-1 text-[0.9rem] leading-relaxed text-muted-foreground">
          {row.topic}
        </p>
      ) : null}
      <p className="mt-1 text-[0.85rem] text-muted-foreground">
        {[years, row.coGuide ? `with ${row.coGuide}` : null]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </>
  );
}

export function GuidanceSection({
  initialItems,
}: {
  initialItems: GuidanceRow[];
}) {
  return (
    <RepeatableSection<GuidanceRow>
      initialItems={initialItems}
      noun={{ singular: 'Student', plural: 'Research guidance' }}
      description="Doctoral and masters students supervised."
      fields={FIELDS}
      schema={guidanceSchema}
      toFormValues={(row) => ({
        studentName: row.studentName,
        nameDisplay: row.nameDisplay,
        degree: row.degree,
        topic: row.topic ?? '',
        status: row.status,
        startYear: row.startYear?.toString() ?? '',
        awardYear: row.awardYear?.toString() ?? '',
        coGuide: row.coGuide ?? '',
      })}
      renderSummary={summaryLine}
      onCreate={createGuidanceAction}
      onUpdate={updateGuidanceAction}
      onDelete={deleteGuidanceAction}
      onReorder={reorderGuidanceAction}
    />
  );
}
