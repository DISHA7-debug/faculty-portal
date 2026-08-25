'use client';

import { useRef } from 'react';

/** Same GET-form-in-the-URL pattern as every other filter form in this codebase. */
export function LogsFilters({
  action,
  from,
  to,
  actions,
}: {
  action: string;
  from: string;
  to: string;
  actions: string[];
}) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const submit = () => formRef.current?.requestSubmit();

  function dropEmptyFields(event: React.FormEvent<HTMLFormElement>) {
    for (const el of event.currentTarget.elements) {
      if (
        (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) &&
        el.name &&
        el.value === ''
      ) {
        el.disabled = true;
      }
    }
  }

  return (
    <form
      ref={formRef}
      method="get"
      action="/admin/logs"
      role="search"
      onSubmit={dropEmptyFields}
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
    >
      <div className="sm:w-56">
        <label htmlFor="log-action" className="mb-1 block text-[0.72rem] text-muted-foreground">
          Action
        </label>
        <select
          id="log-action"
          name="action"
          defaultValue={action}
          onChange={submit}
          className="min-h-10 w-full rounded-md border border-input bg-surface-raised px-3 text-[0.88rem] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">All actions</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="log-from" className="mb-1 block text-[0.72rem] text-muted-foreground">
          From
        </label>
        <input
          id="log-from"
          type="date"
          name="from"
          defaultValue={from}
          className="min-h-10 rounded-md border border-input bg-surface-raised px-3 text-[0.88rem] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div>
        <label htmlFor="log-to" className="mb-1 block text-[0.72rem] text-muted-foreground">
          To
        </label>
        <input
          id="log-to"
          type="date"
          name="to"
          defaultValue={to}
          className="min-h-10 rounded-md border border-input bg-surface-raised px-3 text-[0.88rem] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <button
        type="submit"
        className="min-h-10 shrink-0 rounded-md bg-primary px-4 text-[0.85rem] text-primary-foreground transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        Filter
      </button>

      {action || from || to ? (
        <a
          href="/admin/logs"
          className="inline-flex min-h-10 items-center text-[0.85rem] text-muted-foreground underline decoration-hairline underline-offset-4 transition-colors hover:decoration-current"
        >
          Clear
        </a>
      ) : null}
    </form>
  );
}
