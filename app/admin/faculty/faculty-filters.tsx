'use client';

import { useRef } from 'react';

import { STATUS_LABELS } from './status';

export type DepartmentOption = { id: string; name: string };

/**
 * Search and filter controls, in the URL — same reasoning as
 * components/public/directory-filters.tsx: a filtered admin view is something one admin
 * tells another about ("check the SUSPENDED ones in ECE"), and a plain `<form method="get">`
 * means it works before hydration and survives a bookmark or a page reload.
 */
export function FacultyFilters({
  q,
  status,
  departmentId,
  departments,
}: {
  q: string;
  status: string;
  departmentId: string;
  /** Omitted entirely for a DEPT_ADMIN — their scope is fixed, so the control would do
   *  nothing but suggest a choice that does not exist. */
  departments: DepartmentOption[] | null;
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
      action="/admin/faculty"
      role="search"
      onSubmit={dropEmptyFields}
      className="flex flex-col gap-3 sm:flex-row"
    >
      <div className="flex-1">
        <label htmlFor="fac-q" className="sr-only">
          Search by name or email
        </label>
        <input
          id="fac-q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Search by name or email…"
          className="min-h-10 w-full rounded-md border border-input bg-surface-raised px-3.5 text-[0.9rem] outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="sm:w-48">
        <label htmlFor="fac-status" className="sr-only">
          Status
        </label>
        <select
          id="fac-status"
          name="status"
          defaultValue={status}
          onChange={submit}
          className="min-h-10 w-full rounded-md border border-input bg-surface-raised px-3 text-[0.88rem] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {departments ? (
        <div className="sm:w-52">
          <label htmlFor="fac-dept" className="sr-only">
            Department
          </label>
          <select
            id="fac-dept"
            name="department"
            defaultValue={departmentId}
            onChange={submit}
            className="min-h-10 w-full rounded-md border border-input bg-surface-raised px-3 text-[0.88rem] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <button
        type="submit"
        className="min-h-10 shrink-0 rounded-md bg-primary px-4 text-[0.85rem] text-primary-foreground transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        Search
      </button>
    </form>
  );
}
