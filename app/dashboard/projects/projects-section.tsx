'use client';

import {
  RepeatableSection,
  type FieldConfig,
} from '@/components/dashboard/repeatable-section';
import {
  PROJECT_STATUS_LABELS as STATUS_LABELS,
  PROJECT_TYPE_LABELS as TYPE_LABELS,
  labelOf,
} from '@/lib/labels';
import { researchProjectSchema } from '@/lib/validation/sections';

import {
  createResearchProjectAction,
  deleteResearchProjectAction,
  reorderResearchProjectAction,
  updateResearchProjectAction,
  type ResearchProjectRow,
} from './actions';

/**
 * ResearchProject's configuration for the generic section component.
 *
 * Entity-specific only: field list, summary line, and which server actions to call.
 * The component itself knows nothing about sponsored projects.
 */

/**
 * Two decimal places always.
 *
 * The column is Decimal(12,2) so 42.50 is stored exactly, but Decimal.toString() drops the
 * trailing zero and renders "₹42.5 lakh", which reads like a typo for a funding figure.
 */
function formatLakhs(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : value;
}

const FIELDS: FieldConfig[] = [
  { name: 'title', label: 'Project title', type: 'text', required: true },
  {
    name: 'type',
    label: 'Type',
    type: 'select',
    required: true,
    span: 1,
    options: Object.entries(TYPE_LABELS).map(([value, label]) => ({
      value,
      label,
    })),
  },
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
  { name: 'agency', label: 'Funding agency', type: 'text', span: 1 },
  {
    name: 'role',
    label: 'Your role',
    type: 'text',
    span: 1,
    placeholder: 'Principal Investigator',
  },
  {
    name: 'amountLakhs',
    label: 'Amount (lakhs)',
    type: 'text',
    span: 1,
    placeholder: '42.50',
  },
];

function summaryLine(row: ResearchProjectRow) {
  return (
    <>
      <p className="text-[0.7rem] font-mono uppercase tracking-[0.14em] text-muted-foreground">
        {labelOf(TYPE_LABELS, row.type)} · {labelOf(STATUS_LABELS, row.status)}
      </p>
      <p className="mt-1.5 text-[1.05rem] leading-snug font-medium">
        {row.title}
      </p>
      <p className="mt-1 text-[0.9rem] leading-relaxed text-muted-foreground">
        {[
          row.agency,
          row.role,
          row.amountLakhs ? `₹${formatLakhs(row.amountLakhs)} lakh` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </>
  );
}

export function ResearchProjectSection({
  initialItems,
}: {
  initialItems: ResearchProjectRow[];
}) {
  return (
    <RepeatableSection<ResearchProjectRow>
      initialItems={initialItems}
      noun={{ singular: 'Project', plural: 'Sponsored projects' }}
      description="Funded research and consultancy. Amounts are in lakhs."
      fields={FIELDS}
      schema={researchProjectSchema}
      toFormValues={(row) => ({
        title: row.title,
        type: row.type,
        status: row.status,
        agency: row.agency ?? '',
        role: row.role ?? '',
        amountLakhs: row.amountLakhs ?? '',
      })}
      renderSummary={summaryLine}
      onCreate={createResearchProjectAction}
      onUpdate={updateResearchProjectAction}
      onDelete={deleteResearchProjectAction}
      onReorder={reorderResearchProjectAction}
    />
  );
}
