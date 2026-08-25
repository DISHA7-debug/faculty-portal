'use client';

import {
  RepeatableSection,
  type FieldConfig,
} from '@/components/dashboard/repeatable-section';
import { educationSchema } from '@/lib/validation/education';

import {
  createEducationAction,
  deleteEducationAction,
  reorderEducationAction,
  updateEducationAction,
  type EducationRow,
} from './actions';
import { DEGREE_LEVEL_LABELS as LEVEL_LABELS } from '@/lib/labels';

/**
 * Education's configuration for the generic section component.
 *
 * Everything entity-specific lives here: the field list, the summary line, and which
 * server actions to call. The component itself knows nothing about degrees.
 */

const FIELDS: FieldConfig[] = [
  {
    name: 'degree',
    label: 'Degree',
    type: 'text',
    required: true,
    placeholder: 'Ph.D.',
    span: 1,
  },
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
    name: 'field',
    label: 'Field of study',
    type: 'text',
    placeholder: 'Computer Science',
    span: 1,
  },
  {
    name: 'institution',
    label: 'Institution',
    type: 'text',
    required: true,
    span: 1,
  },
  { name: 'yearFrom', label: 'From year', type: 'number', span: 1 },
  { name: 'yearTo', label: 'To year', type: 'number', span: 1 },
];

function summaryLine(row: EducationRow) {
  const years =
    row.yearFrom && row.yearTo
      ? `${row.yearFrom}–${row.yearTo}`
      : (row.yearTo ?? row.yearFrom ?? null);

  return (
    <>
      <p className="text-[1.05rem] leading-snug">
        <span className="font-medium">{row.degree}</span>
        {row.field ? (
          <span className="text-muted-foreground"> in {row.field}</span>
        ) : null}
      </p>
      <p className="mt-1 text-[0.9rem] leading-relaxed text-muted-foreground">
        {row.institution}
        {years ? <span> · {years}</span> : null}
      </p>
    </>
  );
}

export function EducationSection({
  initialItems,
}: {
  initialItems: EducationRow[];
}) {
  return (
    <RepeatableSection<EducationRow>
      initialItems={initialItems}
      noun={{ singular: 'Education entry', plural: 'Education' }}
      description="Listed newest first is conventional, but the order is yours — drag, or use the arrow buttons."
      fields={FIELDS}
      schema={educationSchema}
      toFormValues={(row) => ({
        degree: row.degree,
        level: row.level,
        field: row.field ?? '',
        institution: row.institution,
        yearFrom: row.yearFrom?.toString() ?? '',
        yearTo: row.yearTo?.toString() ?? '',
      })}
      renderSummary={summaryLine}
      onCreate={createEducationAction}
      onUpdate={updateEducationAction}
      onDelete={deleteEducationAction}
      onReorder={reorderEducationAction}
    />
  );
}
