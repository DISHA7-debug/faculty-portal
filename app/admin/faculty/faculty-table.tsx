'use client';

import { Role, type AccountStatus } from '@prisma/client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { changeRoleAction, reactivateAction, suspendAction } from './actions';
import { STATUS_LABELS, STATUS_TONE } from './status';

export type FacultyRow = {
  id: string;
  email: string;
  fullName: string;
  departmentName: string;
  role: Role;
  status: AccountStatus;
};

const ROLE_LABELS: Record<Role, string> = {
  FACULTY: 'Faculty',
  DEPT_ADMIN: 'Department admin',
  SUPER_ADMIN: 'Super admin',
};

function StatusBadge({ status }: { status: AccountStatus }) {
  const tone = STATUS_TONE[status];
  const toneClass = {
    neutral: 'bg-secondary text-secondary-foreground',
    positive: 'bg-success/15 text-success',
    negative: 'bg-destructive/12 text-destructive',
    warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  }[tone];

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.72rem] font-medium whitespace-nowrap ${toneClass}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

/**
 * The faculty roster.
 *
 * ── Why the role selector only renders for a SUPER_ADMIN viewer ─────────────────────────
 *
 * Not a display nicety — `changeRoleAction` refuses anyone but SUPER_ADMIN server-side
 * (see the long comment on it in actions.ts), so a DEPT_ADMIN seeing a role dropdown that
 * always fails would be worse than not offering the control at all: it invites a support
 * ticket for a button that was never going to work. Hiding UI is never the authorization
 * (CLAUDE.md §3.1) — it is the SERVER check that makes this safe; the hidden control is
 * just not misleading anyone about what they can do.
 */
export function FacultyTable({
  initialRows,
  viewerIsSuperAdmin,
  viewerUserId,
}: {
  initialRows: FacultyRow[];
  viewerIsSuperAdmin: boolean;
  viewerUserId: string;
}) {
  const [rows, setRows] = useState(initialRows);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
        <p className="text-[0.95rem] text-muted-foreground">
          No accounts match these filters.
        </p>
      </div>
    );
  }

  function patch(id: string, next: Partial<FacultyRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...next } : r)));
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-hairline">
      <table className="w-full text-left text-[0.88rem]">
        <thead>
          <tr className="border-b border-hairline bg-surface-sunken text-[0.72rem] text-muted-foreground uppercase tracking-[0.08em]">
            <th className="px-4 py-3 font-medium">Name</th>
            <th className="px-4 py-3 font-medium">Department</th>
            <th className="px-4 py-3 font-medium">Role</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {rows.map((row) => (
            <FacultyRowItem
              key={row.id}
              row={row}
              viewerIsSuperAdmin={viewerIsSuperAdmin}
              isSelf={row.id === viewerUserId}
              onChange={(next) => patch(row.id, next)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FacultyRowItem({
  row,
  viewerIsSuperAdmin,
  isSelf,
  onChange,
}: {
  row: FacultyRow;
  viewerIsSuperAdmin: boolean;
  isSelf: boolean;
  onChange: (next: Partial<FacultyRow>) => void;
}) {
  const [pending, startTransition] = useTransition();

  function suspend() {
    if (!confirm(`Suspend ${row.fullName}? This ends every active session immediately.`)) return;
    startTransition(async () => {
      const result = await suspendAction(row.id);
      if (result.ok) {
        onChange({ status: 'SUSPENDED' });
        toast.success(`${row.fullName} suspended.`);
      } else {
        toast.error(result.error);
      }
    });
  }

  function reactivate() {
    startTransition(async () => {
      const result = await reactivateAction(row.id);
      if (result.ok) {
        onChange({ status: 'ACTIVE' });
        toast.success(`${row.fullName} reactivated.`);
      } else {
        toast.error(result.error);
      }
    });
  }

  function changeRole(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value as Role;
    const previous = row.role;
    onChange({ role: next }); // optimistic
    startTransition(async () => {
      const result = await changeRoleAction(row.id, next);
      if (!result.ok) {
        onChange({ role: previous }); // visible rollback
        toast.error(result.error);
      } else {
        toast.success(`${row.fullName} is now ${ROLE_LABELS[next]}.`);
      }
    });
  }

  return (
    <tr className="align-middle">
      <td className="px-4 py-3">
        <p className="font-medium">{row.fullName}</p>
        <p className="text-[0.8rem] text-muted-foreground">{row.email}</p>
      </td>
      <td className="px-4 py-3 text-muted-foreground">{row.departmentName}</td>
      <td className="px-4 py-3">
        {viewerIsSuperAdmin ? (
          <select
            value={row.role}
            disabled={pending || isSelf}
            onChange={changeRole}
            aria-label={`Role for ${row.fullName}`}
            title={isSelf ? 'You cannot change your own role.' : undefined}
            className="min-h-8 rounded-md border border-input bg-surface-raised px-2 text-[0.85rem] outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        ) : (
          ROLE_LABELS[row.role]
        )}
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={row.status} />
      </td>
      <td className="px-4 py-3 text-right">
        {isSelf ? (
          <span className="text-[0.8rem] text-muted-foreground">You</span>
        ) : row.status === 'SUSPENDED' ? (
          <button
            type="button"
            onClick={reactivate}
            disabled={pending}
            className="inline-flex min-h-8 items-center rounded-md border border-border px-3 text-[0.82rem] transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
          >
            Reactivate
          </button>
        ) : row.status === 'ACTIVE' ? (
          <button
            type="button"
            onClick={suspend}
            disabled={pending}
            className="inline-flex min-h-8 items-center rounded-md border border-border px-3 text-[0.82rem] text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
          >
            Suspend
          </button>
        ) : (
          // PENDING_VERIFICATION, PENDING_APPROVAL, REJECTED: nothing to do from this
          // table. Approval itself happens on /admin/approvals, which is the workflow
          // built for that decision — a second "approve" control here would let the two
          // pages disagree about what "approving" requires.
          <span className="text-[0.8rem] text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  );
}
