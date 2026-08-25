'use client';

import Link from 'next/link';
import { useRef } from 'react';

import type { Facet } from '@/lib/directory';

/**
 * Search and filter controls for the directory.
 *
 * ── A real GET form ─────────────────────────────────────────────────────────────────────
 *
 * `<form method="get" action="/faculty">`, so it works with JavaScript disabled, before
 * hydration, and from a browser's saved-search bar. The client half only ADDS convenience:
 * changing a select submits immediately instead of waiting for the button.
 *
 * The Search button is always visible. Hiding it once JS loads is a common trick and a bad
 * one — it needs a script to detect scripting, it flickers on slow connections, and it
 * removes the explicit submit that keyboard and screen-reader users rely on. A visible
 * button beside a search field is what people expect anyway.
 *
 * Filters live in the URL rather than in component state. A filtered directory is something
 * people send to each other — "here, the HCI people" — and state that is not in the URL
 * cannot be shared, bookmarked, or reached with the back button.
 *
 * ── The page parameter is dropped on purpose ────────────────────────────────────────────
 *
 * Changing a filter while on page 3 must not keep `page=3`: the new result set is almost
 * certainly shorter, and the visitor would land on an empty page having done nothing wrong.
 * There is no hidden `page` input, so submitting always resets to page 1.
 *
 * ── Empty fields are dropped from the URL ───────────────────────────────────────────────
 *
 * A GET form submits every named control, so picking one department produced
 * `?q=&department=mechanical-engineering&designation=` — three parameters for one choice.
 * That is the URL a visitor copies out of the address bar and sends to a colleague, so it
 * is worth keeping legible.
 *
 * The fix is to disable empty controls immediately before submission: a disabled control is
 * not submitted, and disabling during the submit handler is invisible to the user. Without
 * JavaScript the empty parameters come back, and the page reads them as absent — so this is
 * a cosmetic improvement layered on a form that already worked, not a dependency.
 */
export function DirectoryFilters({
  q,
  department,
  designation,
  departments,
  designations,
  total,
}: {
  q: string;
  department: string;
  designation: string;
  departments: Facet[];
  designations: Facet[];
  total: number;
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

  const hasFilters = Boolean(q || department || designation);

  return (
    <form
      ref={formRef}
      method="get"
      action="/faculty"
      onSubmit={dropEmptyFields}
      role="search"
      className="space-y-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <label htmlFor="q" className="sr-only">
            Search faculty by name, research interest, or biography
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Search by name or research area…"
            className="min-h-11 w-full rounded-md border border-input bg-surface-raised px-3.5 text-[0.95rem] outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <Select
          id="department"
          label="Department"
          value={department}
          options={departments}
          allLabel="All departments"
          onChange={submit}
        />
        <Select
          id="designation"
          label="Designation"
          value={designation}
          options={designations}
          allLabel="All designations"
          onChange={submit}
        />

        <button
          type="submit"
          className="min-h-11 shrink-0 rounded-md bg-primary px-5 text-[0.9rem] text-primary-foreground transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          Search
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p aria-live="polite" className="text-[0.85rem] text-muted-foreground">
          {total === 0
            ? 'No matches'
            : `${total} ${total === 1 ? 'person' : 'people'}`}
          {hasFilters ? ' for these filters' : ''}
        </p>

        {hasFilters ? (
          // A link, not a reset button: clearing filters means navigating to the
          // unfiltered URL, and a link is the control for going somewhere.
          <Link
            href="/faculty"
            className="inline-block py-1 text-[0.85rem] underline decoration-hairline underline-offset-4 transition-colors hover:decoration-current focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Clear filters
          </Link>
        ) : null}
      </div>
    </form>
  );
}

function Select({
  id,
  label,
  value,
  options,
  allLabel,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: Facet[];
  allLabel: string;
  onChange: () => void;
}) {
  return (
    <div className="sm:w-52">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        name={id}
        defaultValue={value}
        onChange={onChange}
        className="min-h-11 w-full rounded-md border border-input bg-surface-raised px-3 text-[0.9rem] outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label} ({o.count})
          </option>
        ))}
      </select>
    </div>
  );
}
