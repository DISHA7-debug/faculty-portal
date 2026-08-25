'use client';

import {
  RepeatableSection,
  type FieldConfig,
} from '@/components/dashboard/repeatable-section';
import { membershipSchema } from '@/lib/validation/sections';

import {
  createMembershipAction,
  deleteMembershipAction,
  reorderMembershipAction,
  updateMembershipAction,
  type MembershipRow,
} from './membership-actions';

/**
 * Membership's configuration for the generic section component.
 *
 * Entity-specific only: field list, summary line, and which server actions to call.
 * The component itself knows nothing about professional memberships.
 */

const FIELDS: FieldConfig[] = [
  { name: 'body', label: 'Body', type: 'text', required: true, placeholder: 'IEEE', span: 1 },
  { name: 'membershipType', label: 'Grade', type: 'text', placeholder: 'Senior Member', span: 1 },
  { name: 'sinceYear', label: 'Member since', type: 'number', span: 1 },
  { name: 'membershipNo', label: 'Membership number', type: 'text', span: 1, hint: 'Kept private.' },
];

function summaryLine(row: MembershipRow) {

  return (
    <>
      <p className="text-[1.05rem] leading-snug font-medium">{row.body}</p>
      <p className="mt-1 text-[0.9rem] leading-relaxed text-muted-foreground">
        {[row.membershipType, row.sinceYear ? `since ${row.sinceYear}` : null]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </>
  );
}

export function MembershipSection({ initialItems }: { initialItems: MembershipRow[] }) {
  return (
    <RepeatableSection<MembershipRow>
      initialItems={initialItems}
      noun={{ singular: 'Membership', plural: 'Professional memberships' }}
      description="Learned societies and professional bodies. Membership numbers are stored but never shown publicly."
      fields={FIELDS}
      schema={membershipSchema}
      toFormValues={(row) => ({
        body: row.body,
        membershipType: row.membershipType ?? '',
        sinceYear: row.sinceYear?.toString() ?? '',
        membershipNo: row.membershipNo ?? '',
      })}
      renderSummary={summaryLine}
      onCreate={createMembershipAction}
      onUpdate={updateMembershipAction}
      onDelete={deleteMembershipAction}
      onReorder={reorderMembershipAction}
    />
  );
}
