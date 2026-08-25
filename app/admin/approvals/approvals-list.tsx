'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

import { approveAction, rejectAction } from './actions';

export type ApprovalRow = {
  id: string;
  email: string;
  fullName: string;
  departmentName: string;
  signedUpAt: string; // ISO
};

/** "3 days ago", not a raw timestamp — the age of the request is the thing that matters. */
function relativeAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return `${months} ${months === 1 ? 'month' : 'months'} ago`;
}

export function ApprovalsList({ initialRows }: { initialRows: ApprovalRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const reduceMotion = useReducedMotion();

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
        <p className="text-[0.95rem] text-muted-foreground">
          No pending accounts right now.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-hairline border-t border-hairline">
      <AnimatePresence initial={false}>
        {rows.map((row) => (
          <motion.li
            key={row.id}
            layout={!reduceMotion}
            initial={false}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 26 }}
            className="overflow-hidden"
          >
            <ApprovalRowItem
              row={row}
              onResolved={(id) => setRows((prev) => prev.filter((r) => r.id !== id))}
            />
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

function ApprovalRowItem({
  row,
  onResolved,
}: {
  row: ApprovalRow;
  onResolved: (id: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);

  function approve() {
    startTransition(async () => {
      const result = await approveAction(row.id);
      if (result.ok) {
        toast.success(`${row.fullName} approved.`);
        onResolved(row.id);
      } else {
        toast.error(result.error);
      }
    });
  }

  function reject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setReasonError(null);
    startTransition(async () => {
      const result = await rejectAction(row.id, reason);
      if (result.ok) {
        toast.success(`${row.fullName}'s registration rejected.`);
        setRejectOpen(false);
        onResolved(row.id);
      } else {
        setReasonError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-[1rem] leading-snug font-medium">{row.fullName}</p>
        <p className="mt-0.5 truncate text-[0.85rem] text-muted-foreground">{row.email}</p>
        <p className="mt-1 text-[0.8rem] text-muted-foreground">
          {row.departmentName} · signed up {relativeAge(row.signedUpAt)}
        </p>
      </div>

      <div className="flex shrink-0 gap-2">
        <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
          <DialogTrigger asChild>
            <button
              type="button"
              disabled={pending}
              className="inline-flex min-h-9 items-center rounded-md border border-border px-3.5 text-[0.85rem] text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
            >
              Reject
            </button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reject {row.fullName}&rsquo;s registration</DialogTitle>
              <DialogDescription>
                This reason is emailed to {row.email} verbatim, so write it as something
                you&rsquo;d be comfortable sending directly.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={reject} className="space-y-3">
              <div>
                <label htmlFor={`reason-${row.id}`} className="sr-only">
                  Reason for rejection
                </label>
                <textarea
                  id={`reason-${row.id}`}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setReasonError(null);
                  }}
                  rows={4}
                  required
                  minLength={10}
                  placeholder="e.g. We could not confirm an active faculty appointment in this department."
                  className="w-full rounded-md border border-input bg-surface-raised px-3 py-2 text-[0.9rem] outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring"
                />
                {reasonError ? (
                  <p role="alert" className="mt-1.5 text-[0.82rem] text-destructive">
                    {reasonError}
                  </p>
                ) : (
                  <p className="mt-1.5 text-[0.78rem] text-muted-foreground">
                    {reason.trim().length}/10 characters minimum
                  </p>
                )}
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <button
                    type="button"
                    className="inline-flex min-h-9 items-center rounded-md border border-border px-4 text-[0.85rem] transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    Cancel
                  </button>
                </DialogClose>
                <button
                  type="submit"
                  disabled={pending || reason.trim().length < 10}
                  className="inline-flex min-h-9 items-center rounded-md bg-destructive px-4 text-[0.85rem] text-destructive-foreground transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
                >
                  {pending ? 'Sending…' : 'Reject and notify'}
                </button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <button
          type="button"
          onClick={approve}
          disabled={pending}
          className="inline-flex min-h-9 items-center rounded-md bg-primary px-3.5 text-[0.85rem] text-primary-foreground transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
        >
          {pending ? 'Working…' : 'Approve'}
        </button>
      </div>
    </div>
  );
}
