'use client';

import {
  RepeatableSection,
  type FieldConfig,
} from '@/components/dashboard/repeatable-section';
import { publicationSchema } from '@/lib/validation/publication';

import {
  createPublicationAction,
  deletePublicationAction,
  reorderPublicationAction,
  updatePublicationAction,
  type PublicationRow,
} from './actions';
import { PUBLICATION_TYPE_LABELS as TYPE_LABELS, labelOf } from '@/lib/labels';

const FIELDS: FieldConfig[] = [
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
  { name: 'year', label: 'Year', type: 'number', span: 1 },
  { name: 'title', label: 'Title', type: 'text', required: true },
  {
    name: 'authors',
    label: 'Authors',
    type: 'text',
    required: true,
    hint: 'As they appear on the paper, in order.',
    placeholder: 'Sharma A., Verma B., Singh C.',
  },
  { name: 'venue', label: 'Journal or conference', type: 'text' },
  {
    name: 'doi',
    label: 'DOI',
    type: 'text',
    span: 1,
    hint: 'A full doi.org link is fine — it will be tidied automatically.',
    placeholder: '10.1109/TPDS.2024.123',
  },
  { name: 'publisher', label: 'Publisher', type: 'text', span: 1 },
  { name: 'volume', label: 'Volume', type: 'text', span: 1 },
  { name: 'issue', label: 'Issue', type: 'text', span: 1 },
  { name: 'pages', label: 'Pages', type: 'text', span: 1 },
  {
    name: 'url',
    label: 'Link',
    type: 'text',
    span: 1,
    placeholder: 'https://…',
  },
];

function summaryLine(row: PublicationRow) {
  const meta = [
    row.venue,
    row.volume ? `Vol. ${row.volume}` : null,
    row.issue ? `No. ${row.issue}` : null,
    row.pages,
    row.year?.toString(),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <p className="text-[0.7rem] font-mono uppercase tracking-[0.14em] text-muted-foreground">
        {labelOf(TYPE_LABELS, row.type)}
      </p>
      {/* Long titles are the norm in academic work — wrap, never truncate. */}
      <p className="mt-1.5 text-[1.05rem] leading-snug font-medium">
        {row.title}
      </p>
      <p className="mt-1 text-[0.9rem] leading-relaxed text-muted-foreground">
        {row.authors}
      </p>
      {meta ? (
        <p className="mt-1 text-[0.85rem] leading-relaxed text-muted-foreground">
          {meta}
        </p>
      ) : null}
      {row.doi ? (
        <p className="mt-1 font-mono text-[0.78rem] break-all text-muted-foreground">
          doi:{row.doi}
        </p>
      ) : null}
    </>
  );
}

export function PublicationsSection({
  initialItems,
}: {
  initialItems: PublicationRow[];
}) {
  return (
    <RepeatableSection<PublicationRow>
      initialItems={initialItems}
      noun={{ singular: 'Publication', plural: 'Publications' }}
      description="Paste a DOI in any format — a doi.org link, a doi: prefix, or the bare identifier. Duplicates are caught automatically."
      fields={FIELDS}
      schema={publicationSchema}
      toFormValues={(row) => ({
        type: row.type,
        title: row.title,
        authors: row.authors,
        venue: row.venue ?? '',
        year: row.year?.toString() ?? '',
        doi: row.doi ?? '',
        url: row.url ?? '',
        publisher: row.publisher ?? '',
        volume: row.volume ?? '',
        issue: row.issue ?? '',
        pages: row.pages ?? '',
      })}
      renderSummary={summaryLine}
      onCreate={createPublicationAction}
      onUpdate={updatePublicationAction}
      onDelete={deletePublicationAction}
      onReorder={reorderPublicationAction}
    />
  );
}
