'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { removeFileAction } from '@/app/dashboard/profile/actions';

/** CV picker. No crop — a PDF is stored as received (docs/SECURITY.md §5.1). */
export function CvUpload({
  currentUrl,
  onUploaded,
}: {
  currentUrl: string | null;
  onUploaded?: () => void;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function send(file: File) {
    setError(null);

    // Instant feedback only; the server sniffs magic bytes regardless.
    if (file.type && !file.type.includes('pdf')) {
      setError(
        file.type.startsWith('image/')
          ? 'That is an image, not a PDF. Use the photo field above for pictures.'
          : 'Your CV must be a PDF.',
      );
      return;
    }

    const form = new FormData();
    form.set('kind', 'cv');
    form.set('file', file, file.name);

    setProgress(0);
    const result = await new Promise<{ status: number; body: Record<string, unknown> }>(
      (resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/upload');
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        });
        xhr.addEventListener('load', () => {
          let parsed: Record<string, unknown> = {};
          try { parsed = JSON.parse(xhr.responseText); } catch { /* non-JSON */ }
          resolve({ status: xhr.status, body: parsed });
        });
        xhr.addEventListener('error', () => resolve({ status: 0, body: {} }));
        xhr.send(form);
      },
    );
    setProgress(null);

    if (result.status !== 200) {
      setError(
        (result.body.error as string) ??
          (result.status === 401
            ? 'Your session has expired. Sign in again.'
            : 'That upload failed. Try again, or use a different file.'),
      );
      return;
    }

    toast.success('CV updated.');
    onUploaded?.();
  }

  async function handleRemove() {
    setConfirming(false);
    const result = await removeFileAction('cv');
    if (result.ok) {
      toast.success('CV removed.');
      onUploaded?.();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <section aria-labelledby="cv-heading" className="space-y-4">
      <h3 id="cv-heading" className="text-[1.1rem] leading-snug font-medium">
        Curriculum vitae
      </h3>

      {error ? (
        <p
          role="alert"
          data-testid="cv-error"
          className="rounded-md border border-destructive/35 bg-destructive/8 px-4 py-3 text-[0.875rem] leading-relaxed"
        >
          {error}
        </p>
      ) : null}

      {progress !== null ? (
        <div className="space-y-2">
          <div
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Upload progress"
            className="h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken"
          >
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.max(progress, 4)}%` }} />
          </div>
          <p aria-live="polite" className="text-[0.85rem] text-muted-foreground">
            Uploading… {progress}%
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {currentUrl ? (
            <a
              href={currentUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex min-h-11 items-center rounded-md border border-border bg-surface-raised px-4 text-[0.9rem] transition-colors outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
            >
              View current CV
            </a>
          ) : (
            <span className="text-[0.9rem] text-muted-foreground">No CV uploaded.</span>
          )}

          <input
            ref={inputRef}
            id="cv-input"
            type="file"
            accept="application/pdf"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void send(file);
              e.target.value = '';
            }}
          />
          <label
            htmlFor="cv-input"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); }
            }}
            className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-border bg-surface-raised px-4 text-[0.9rem] font-medium transition-colors outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {currentUrl ? 'Replace CV' : 'Upload your CV'}
          </label>

          {currentUrl ? (
            confirming ? (
              <span className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={handleRemove}
                  className="inline-flex min-h-11 items-center rounded-md bg-destructive px-4 text-[0.9rem] font-medium text-destructive-foreground transition-colors outline-none hover:bg-destructive/90 focus-visible:ring-2 focus-visible:ring-ring">
                  Yes, remove
                </button>
                <button type="button" onClick={() => setConfirming(false)}
                  className="inline-flex min-h-11 items-center rounded-md px-3 text-[0.9rem] transition-colors outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring">
                  Keep it
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirming(true)}
                className="inline-flex min-h-11 items-center rounded-md px-4 text-[0.9rem] font-medium text-destructive transition-colors outline-none hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring">
                Remove
              </button>
            )
          ) : null}
        </div>
      )}

      <p className="text-[0.8rem] leading-relaxed text-muted-foreground">
        PDF only, up to 10&nbsp;MB.
      </p>
    </section>
  );
}
