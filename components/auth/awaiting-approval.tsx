import Link from 'next/link';

/**
 * The "verified, but not yet approved" state.
 *
 * Built once and used twice: as a full screen straight after email confirmation, and as a
 * persistent banner across the dashboard until an administrator acts.
 *
 * The thing this must NOT be is a disabled Publish button with a tooltip. Someone in this
 * state has done everything asked of them, and the account is working — the only thing
 * missing is another person's decision. A greyed-out control communicates "you have done
 * something wrong"; this communicates "you are waiting on us", which is the truth.
 *
 * Three facts, in the order they matter:
 *   1. Your address is confirmed — the part you controlled is finished.
 *   2. You can edit everything right now — the account is not frozen.
 *   3. Publication needs an administrator — and here is who that is.
 */

type Props = {
  /** 'screen' straight after verification; 'banner' inside the dashboard. */
  variant?: 'screen' | 'banner';
  /** Shown when known, so "an administrator" has a department attached to it. */
  departmentName?: string | null;
};

function Facts({ departmentName }: { departmentName?: string | null }) {
  const reviewer = departmentName
    ? `an administrator for ${departmentName}`
    : 'your department administrator';

  return (
    <dl className="mt-6 space-y-4">
      <div className="flex gap-3">
        <dt className="sr-only">Email address</dt>
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-[0.7rem] text-success"
        >
          &#10003;
        </span>
        <dd className="text-[0.95rem] leading-relaxed">
          <strong className="font-medium">Your email address is confirmed.</strong> That
          step is done.
        </dd>
      </div>

      <div className="flex gap-3">
        <dt className="sr-only">Editing</dt>
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-[0.7rem] text-success"
        >
          &#10003;
        </span>
        <dd className="text-[0.95rem] leading-relaxed">
          <strong className="font-medium">You can edit your profile now.</strong> Add your
          publications, positions, and research interests — everything saves normally.
        </dd>
      </div>

      <div className="flex gap-3">
        <dt className="sr-only">Publication</dt>
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-warning/20 text-[0.7rem] text-foreground"
        >
          &#8226;
        </span>
        <dd className="text-[0.95rem] leading-relaxed">
          <strong className="font-medium">Publishing is waiting on {reviewer}.</strong>{' '}
          Until they approve the account, your profile stays private and does not appear
          in the public directory.
        </dd>
      </div>
    </dl>
  );
}

export function AwaitingApproval({ variant = 'screen', departmentName }: Props) {
  if (variant === 'banner') {
    return (
      <aside
        aria-labelledby="awaiting-approval-heading"
        className="rounded-lg border border-border bg-surface-raised p-5 sm:p-6"
      >
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
          Account status
        </p>
        <h2
          id="awaiting-approval-heading"
          className="mt-3 text-[1.4rem] leading-snug"
        >
          Awaiting administrator approval
        </h2>
        <Facts departmentName={departmentName} />
      </aside>
    );
  }

  return (
    <>
      <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
        Step 2 of 2
      </p>

      <h1 className="mt-5 text-[2.5rem] leading-[1.08] tracking-[-0.015em] sm:text-[3rem]">
        Awaiting approval
      </h1>

      <p className="measure mt-5 text-[1.05rem] leading-relaxed">
        Your email address is confirmed and your account is active. One step remains, and
        it is not yours to take.
      </p>

      <Facts departmentName={departmentName} />

      <div className="mt-9 flex flex-col gap-3 sm:flex-row">
        <Link
          href="/dashboard"
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-5 text-[0.95rem] font-medium text-primary-foreground transition-colors outline-none hover:bg-primary/92 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Start filling in your profile
        </Link>
      </div>

      <hr className="my-9 border-hairline" />

      <p className="text-[0.875rem] leading-relaxed text-muted-foreground">
        Approvals are made by a person, so there is no fixed timescale. If several days
        pass, contact your department administrator directly — they can see the pending
        queue.
      </p>
    </>
  );
}
