'use client';

import {
  RepeatableSection,
  type FieldConfig,
} from '@/components/dashboard/repeatable-section';
import { awardSchema } from '@/lib/validation/sections';

import {
  createAwardAction,
  deleteAwardAction,
  reorderAwardAction,
  updateAwardAction,
  type AwardRow,
} from './actions';

/**
 * Award's configuration for the generic section component.
 *
 * Entity-specific only: field list, summary line, and which server actions to call.
 * The component itself knows nothing about awards and honours.
 */

const FIELDS: FieldConfig[] = [
  { name: 'title', label: 'Award', type: 'text', required: true },
  { name: 'awardedBy', label: 'Awarded by', type: 'text', span: 1 },
  { name: 'year', label: 'Year', type: 'number', span: 1 },
  { name: 'description', label: 'Description', type: 'text' },
];

function summaryLine(row: AwardRow) {

  return (
    <>
      <p className="text-[1.05rem] leading-snug font-medium">{row.title}</p>
      <p className="mt-1 text-[0.9rem] leading-relaxed text-muted-foreground">
        {[row.awardedBy, row.year?.toString()].filter(Boolean).join(' · ')}
      </p>
      {row.description ? (
        <p className="measure mt-2 text-[0.9rem] leading-relaxed text-muted-foreground">
          {row.description}
        </p>
      ) : null}
    </>
  );
}

export function AwardSection({ initialItems }: { initialItems: AwardRow[] }) {
  return (
    <RepeatableSection<AwardRow>
      initialItems={initialItems}
      noun={{ singular: 'Award', plural: 'Awards and honours' }}
      description="Prizes, fellowships, and recognitions."
      fields={FIELDS}
      schema={awardSchema}
      toFormValues={(row) => ({
        title: row.title,
        awardedBy: row.awardedBy ?? '',
        year: row.year?.toString() ?? '',
        description: row.description ?? '',
      })}
      renderSummary={summaryLine}
      onCreate={createAwardAction}
      onUpdate={updateAwardAction}
      onDelete={deleteAwardAction}
      onReorder={reorderAwardAction}
    />
  );
}
