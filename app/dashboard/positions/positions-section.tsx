'use client';

import {
  RepeatableSection,
  type FieldConfig,
} from '@/components/dashboard/repeatable-section';
import { positionSchema } from '@/lib/validation/sections';

import {
  createPositionAction,
  deletePositionAction,
  reorderPositionAction,
  updatePositionAction,
  type PositionRow,
} from './actions';

/**
 * Position's configuration for the generic section component.
 *
 * Entity-specific only: field list, summary line, and which server actions to call.
 * The component itself knows nothing about positions.
 */

const FIELDS: FieldConfig[] = [
  { name: 'title', label: 'Position title', type: 'text', required: true },
  { name: 'organisation', label: 'Organisation', type: 'text' },
  { name: 'startYear', label: 'From year', type: 'number', span: 1 },
  { name: 'endYear', label: 'To year', type: 'number', span: 1, hint: 'Leave blank if current.' },
  { name: 'description', label: 'Description', type: 'text' },
];

function summaryLine(row: PositionRow) {
  const years =
    row.startYear && row.endYear
      ? `${row.startYear}–${row.endYear}`
      : row.startYear
        ? `${row.startYear}–present`
        : (row.endYear?.toString() ?? null);
  return (
    <>
      <p className="text-[1.05rem] leading-snug font-medium">{row.title}</p>
      {row.organisation ? (
        <p className="mt-1 text-[0.9rem] leading-relaxed text-muted-foreground">
          {row.organisation}
        </p>
      ) : null}
      {years ? (
        <p className="mt-1 text-[0.85rem] text-muted-foreground">{years}</p>
      ) : null}
      {row.description ? (
        <p className="measure mt-2 text-[0.9rem] leading-relaxed text-muted-foreground">
          {row.description}
        </p>
      ) : null}
    </>
  );
}

export function PositionSection({ initialItems }: { initialItems: PositionRow[] }) {
  return (
    <RepeatableSection<PositionRow>
      initialItems={initialItems}
      noun={{ singular: 'Position', plural: 'Positions' }}
      description="Roles held, in the order you want them shown."
      fields={FIELDS}
      schema={positionSchema}
      toFormValues={(row) => ({
        title: row.title,
        organisation: row.organisation ?? '',
        startYear: row.startYear?.toString() ?? '',
        endYear: row.endYear?.toString() ?? '',
        description: row.description ?? '',
      })}
      renderSummary={summaryLine}
      onCreate={createPositionAction}
      onUpdate={updatePositionAction}
      onDelete={deletePositionAction}
      onReorder={reorderPositionAction}
    />
  );
}
