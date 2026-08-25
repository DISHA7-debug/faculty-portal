'use client';

import { AnimatePresence, Reorder, useReducedMotion } from 'framer-motion';
import { useCallback, useId, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { ZodType } from 'zod';

import { Field, inputClass } from '@/components/auth/field';

/**
 * The one CRUD component every repeatable profile section uses.
 *
 * Generic over CLIENT concerns only: list rendering, inline add and edit, delete
 * confirmation, reordering, optimistic updates, and the four list states. Each entity
 * supplies its own Zod schema, field configuration, and server actions.
 *
 * The server side is deliberately NOT generic. See the note at the top of
 * app/dashboard/academics/actions.ts — an ownership check hidden inside a factory is
 * exactly the code nobody can audit.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type FieldConfig =
  | {
      name: string;
      label: string;
      type: 'text' | 'number';
      hint?: string;
      required?: boolean;
      placeholder?: string;
      /** Grid span at >=sm. Defaults to full width. */
      span?: 1 | 2;
    }
  | {
      name: string;
      label: string;
      type: 'select';
      hint?: string;
      required?: boolean;
      options: Array<{ value: string; label: string }>;
      span?: 1 | 2;
    };

export type RowBase = { id: string };

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export type RepeatableSectionProps<T extends RowBase> = {
  /** Server-rendered starting state. */
  initialItems: T[];
  /** Singular and plural, used throughout the copy so nothing reads as a placeholder. */
  noun: { singular: string; plural: string };
  fields: FieldConfig[];
  /** Client-side validation for immediate feedback. The server re-validates regardless. */
  schema: ZodType;
  /** Row -> form values, for edit. */
  toFormValues: (row: T) => Record<string, string>;
  /** Row -> the one-line summary shown when not editing. */
  renderSummary: (row: T) => React.ReactNode;

  onCreate: (values: unknown) => Promise<ActionResult<T[]>>;
  onUpdate: (id: string, values: unknown) => Promise<ActionResult<T[]>>;
  onDelete: (id: string) => Promise<ActionResult<T[]>>;
  onReorder: (payload: { ids: string[] }) => Promise<ActionResult<T[]>>;

  /** Optional guidance shown above the list. */
  description?: React.ReactNode;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RepeatableSection<T extends RowBase>({
  initialItems,
  noun,
  fields,
  schema,
  toFormValues,
  renderSummary,
  onCreate,
  onUpdate,
  onDelete,
  onReorder,
  description,
}: RepeatableSectionProps<T>) {
  const [items, setItems] = useState<T[]>(initialItems);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const reduceMotion = useReducedMotion();

  /** Announces reorder results to screen readers, which cannot see the list move. */
  const [liveMessage, setLiveMessage] = useState('');
  const listRef = useRef<HTMLUListElement>(null);

  /**
   * Runs a mutation optimistically and ROLLS BACK VISIBLY on failure.
   *
   * The snapshot is captured before the optimistic write and restored on failure, so the
   * list can never silently diverge from the server: either the change is confirmed by
   * the returned authoritative list, or it visibly reverts and says why. A silent
   * divergence is worse than an error — the user believes their edit is saved.
   */
  const mutate = useCallback(
    (optimistic: T[] | null, run: () => Promise<ActionResult<T[]>>, describe: string) => {
      const snapshot = items;
      if (optimistic) setItems(optimistic);
      setError(null);

      startTransition(async () => {
        try {
          const result = await run();
          if (result.ok) {
            // Converge on server truth rather than trusting the optimistic guess.
            setItems(result.data);
            return;
          }
          setItems(snapshot);
          setError(result.error);
          toast.error(result.error);
        } catch {
          setItems(snapshot);
          const message = `Could not ${describe}. Your change has been undone.`;
          setError(message);
          toast.error(message);
        }
      });
    },
    [items],
  );

  const move = useCallback(
    (from: number, to: number) => {
      if (to < 0 || to >= items.length) return;
      const next = [...items];
      const [row] = next.splice(from, 1);
      next.splice(to, 0, row);

      setLiveMessage(`Moved to position ${to + 1} of ${items.length}.`);
      mutate(next, () => onReorder({ ids: next.map((r) => r.id) }), 'reorder the list');
    },
    [items, mutate, onReorder],
  );

  const showEmpty = items.length === 0 && !adding;

  return (
    <section aria-labelledby="section-heading" className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="section-heading" className="text-[1.75rem] leading-snug">
            {noun.plural}
          </h2>
          {description ? (
            <p className="measure mt-2 text-[0.9rem] leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>

        {!adding ? (
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              setEditingId(null);
            }}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-[0.9rem] font-medium text-primary-foreground transition-colors outline-none hover:bg-primary/92 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Add {noun.singular.toLowerCase()}
          </button>
        ) : null}
      </header>

      {/* ERROR state — persistent, in addition to the transient toast. */}
      {error ? (
        <p
          role="alert"
          data-testid="section-error"
          className="rounded-md border border-destructive/35 bg-destructive/8 px-4 py-3 text-[0.875rem] leading-relaxed"
        >
          {error}
        </p>
      ) : null}

      {/* Reorder announcements for assistive technology. */}
      <p aria-live="polite" className="sr-only">
        {liveMessage}
      </p>

      {adding ? (
        <EntryForm
          fields={fields}
          schema={schema}
          submitLabel={`Save ${noun.singular.toLowerCase()}`}
          onCancel={() => setAdding(false)}
          onSubmit={(values) => {
            setAdding(false);
            // No optimistic row: the server assigns the id and sortOrder, and inventing a
            // temporary id here would flicker when the real list arrives.
            mutate(null, () => onCreate(values), `add the ${noun.singular.toLowerCase()}`);
          }}
        />
      ) : null}

      {/* EMPTY state */}
      {showEmpty ? (
        <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
          <p className="text-[0.95rem] text-muted-foreground">
            No {noun.plural.toLowerCase()} yet.
          </p>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-surface-raised px-4 text-[0.9rem] font-medium transition-colors outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Add your first {noun.singular.toLowerCase()}
          </button>
        </div>
      ) : null}

      {/* POPULATED state */}
      {items.length > 0 ? (
        <Reorder.Group
          ref={listRef}
          axis="y"
          values={items}
          onReorder={(next: T[]) => {
            // Drag produces the new order directly; persist and converge.
            setItems(next);
            mutate(next, () => onReorder({ ids: next.map((r) => r.id) }), 'reorder the list');
          }}
          className="space-y-3"
        >
          <AnimatePresence initial={false}>
            {items.map((row, index) => (
              <Reorder.Item
                key={row.id}
                value={row}
                /* Springs, never linear easing (CLAUDE.md §6). */
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 100, damping: 20 }
                }
                /* A real exit variant, so removal is visible rather than a jump-cut. */
                exit={
                  reduceMotion
                    ? { opacity: 0 }
                    : { opacity: 0, height: 0, marginBottom: 0, transition: { duration: 0.18 } }
                }
                layout={reduceMotion ? undefined : 'position'}
                /* Dragging is an enhancement; every action below has a keyboard route. */
                drag={reduceMotion ? false : 'y'}
                dragListener={false}
                className="list-none"
              >
                <RowCard
                  row={row}
                  index={index}
                  total={items.length}
                  noun={noun}
                  fields={fields}
                  schema={schema}
                  isEditing={editingId === row.id}
                  isConfirmingDelete={confirmingDelete === row.id}
                  pending={pending}
                  renderSummary={renderSummary}
                  toFormValues={toFormValues}
                  onEdit={() => {
                    setEditingId(row.id);
                    setAdding(false);
                  }}
                  onCancelEdit={() => setEditingId(null)}
                  onSubmitEdit={(values) => {
                    setEditingId(null);
                    mutate(null, () => onUpdate(row.id, values), 'save your changes');
                  }}
                  onRequestDelete={() => setConfirmingDelete(row.id)}
                  onCancelDelete={() => setConfirmingDelete(null)}
                  onConfirmDelete={() => {
                    setConfirmingDelete(null);
                    mutate(
                      items.filter((r) => r.id !== row.id),
                      () => onDelete(row.id),
                      `delete the ${noun.singular.toLowerCase()}`,
                    );
                  }}
                  onMoveUp={() => move(index, index - 1)}
                  onMoveDown={() => move(index, index + 1)}
                />
              </Reorder.Item>
            ))}
          </AnimatePresence>
        </Reorder.Group>
      ) : null}

      {/* LOADING state — a quiet inline note, not a spinner that hides the list. */}
      {pending ? (
        <p role="status" className="text-[0.85rem] text-muted-foreground">
          Saving…
        </p>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function RowCard<T extends RowBase>({
  row,
  index,
  total,
  noun,
  fields,
  schema,
  isEditing,
  isConfirmingDelete,
  pending,
  renderSummary,
  toFormValues,
  onEdit,
  onCancelEdit,
  onSubmitEdit,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  onMoveUp,
  onMoveDown,
}: {
  row: T;
  index: number;
  total: number;
  noun: { singular: string; plural: string };
  fields: FieldConfig[];
  schema: ZodType;
  isEditing: boolean;
  isConfirmingDelete: boolean;
  pending: boolean;
  renderSummary: (row: T) => React.ReactNode;
  toFormValues: (row: T) => Record<string, string>;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSubmitEdit: (values: Record<string, unknown>) => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const iconButton =
    'inline-flex size-9 items-center justify-center rounded-md border border-border bg-surface-raised text-muted-foreground transition-colors outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-40';

  if (isEditing) {
    return (
      <div className="rounded-lg border border-ring/40 bg-surface-raised p-4 sm:p-5">
        <EntryForm
          fields={fields}
          schema={schema}
          initialValues={toFormValues(row)}
          submitLabel="Save changes"
          onCancel={onCancelEdit}
          onSubmit={onSubmitEdit}
        />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface-raised p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">{renderSummary(row)}</div>

        {/*
          Reorder controls are BUTTONS, not only a drag handle. Drag alone is unusable
          with a keyboard, a screen reader, or a tremor — these are the primary control
          and dragging is the enhancement.
        */}
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0 || pending}
            aria-label={`Move ${noun.singular.toLowerCase()} up, currently ${index + 1} of ${total}`}
            className={iconButton}
          >
            <span aria-hidden="true">&uarr;</span>
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index === total - 1 || pending}
            aria-label={`Move ${noun.singular.toLowerCase()} down, currently ${index + 1} of ${total}`}
            className={iconButton}
          >
            <span aria-hidden="true">&darr;</span>
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-hairline pt-3">
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex min-h-9 items-center rounded-md px-2.5 text-[0.85rem] font-medium text-foreground transition-colors outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
        >
          Edit
        </button>

        {isConfirmingDelete ? (
          // Inline confirmation rather than a modal: it keeps the row being deleted on
          // screen, so there is no doubt about which one is about to go.
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[0.85rem] text-muted-foreground">
              Delete this {noun.singular.toLowerCase()}?
            </span>
            <button
              type="button"
              onClick={onConfirmDelete}
              className="inline-flex min-h-9 items-center rounded-md bg-destructive px-2.5 text-[0.85rem] font-medium text-destructive-foreground transition-colors outline-none hover:bg-destructive/90 focus-visible:ring-2 focus-visible:ring-ring"
            >
              Yes, delete
            </button>
            <button
              type="button"
              onClick={onCancelDelete}
              className="inline-flex min-h-9 items-center rounded-md px-2.5 text-[0.85rem] font-medium transition-colors outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
            >
              Keep it
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={onRequestDelete}
            className="inline-flex min-h-9 items-center rounded-md px-2.5 text-[0.85rem] font-medium text-destructive transition-colors outline-none hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

function EntryForm({
  fields,
  schema,
  initialValues,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  fields: FieldConfig[];
  schema: ZodType;
  initialValues?: Record<string, string>;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (values: Record<string, unknown>) => void;
}) {
  const formId = useId();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    const values: Record<string, unknown> = {};
    for (const field of fields) {
      const raw = String(formData.get(field.name) ?? '').trim();

      if (field.type === 'number') {
        // Empty means "not provided", not zero.
        values[field.name] = raw === '' ? null : Number(raw);
      } else if (field.type === 'select') {
        // An untouched select submits '', which is not a member of any enum. Passing it
        // through makes `z.enum(...).optional()` fail with an error the user cannot act
        // on, and — because the failure is on a field they never touched — the form
        // simply refuses to save with no visible cause. Omitting the key lets `.optional()`
        // do its job, while a REQUIRED select still reports a proper "required" error.
        values[field.name] = raw === '' ? undefined : raw;
      } else {
        values[field.name] = raw;
      }
    }

    // Client-side validation is UX only — the server re-validates with the same schema
    // and its answer is the one that counts (docs/SECURITY.md §4).
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      const errors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? '_');
        (errors[key] ??= []).push(issue.message);
      }
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    onSubmit(values);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        {fields.map((field) => (
          <div
            key={field.name}
            className={field.span === 1 ? 'sm:col-span-1' : 'sm:col-span-2'}
          >
            <Field
              id={`${formId}-${field.name}`}
              label={field.label}
              hint={field.hint}
              errors={fieldErrors[field.name]}
            >
              {(props) =>
                field.type === 'select' ? (
                  <select
                    {...props}
                    name={field.name}
                    required={field.required}
                    defaultValue={initialValues?.[field.name] ?? ''}
                    className={`${inputClass} appearance-none bg-[length:1.1rem] bg-[right_0.9rem_center] bg-no-repeat pr-10`}
                    style={{
                      backgroundImage:
                        "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='%236B6B63' stroke-width='1.6'%3E%3Cpath d='M6 8l4 4 4-4'/%3E%3C/svg%3E\")",
                    }}
                  >
                    <option value="" disabled>
                      Select…
                    </option>
                    {field.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    {...props}
                    name={field.name}
                    type={field.type === 'number' ? 'number' : 'text'}
                    inputMode={field.type === 'number' ? 'numeric' : undefined}
                    required={field.required}
                    placeholder={field.placeholder}
                    defaultValue={initialValues?.[field.name] ?? ''}
                    className={inputClass}
                  />
                )
              }
            </Field>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-5 text-[0.9rem] font-medium text-primary-foreground transition-colors outline-none hover:bg-primary/92 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-surface-raised px-5 text-[0.9rem] font-medium transition-colors outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
