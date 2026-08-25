'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { removeFileAction } from '@/app/dashboard/profile/actions';

/**
 * Profile photo: pick, crop, upload, replace, remove.
 *
 * ── The crop is a CONVENIENCE, not a control ────────────────────────────────────
 *
 * Cropping here decides which part of the photo the faculty member wants shown. It is not
 * a security boundary and it is not what guarantees the output size: the server re-encodes
 * every upload to 512×512 webp with sharp regardless of what arrives, because anything a
 * browser produces is attacker-controlled. Skipping the cropper entirely, or posting a
 * 1200×400 image straight to the endpoint, still yields a 512×512 square.
 *
 * ── Keyboard ────────────────────────────────────────────────────────────────────
 *
 * Drag is not the only way to position the crop. Arrow keys nudge, +/- zoom, and "Use the
 * whole image" skips positioning altogether — a drag-only cropper is unusable with a
 * keyboard, a screen reader, or a tremor.
 */

const OUTPUT = 512;
const NUDGE = 12; // px per arrow press, at display scale

type Props = {
  currentUrl: string | null;
  onUploaded?: () => void;
};

type Phase = 'idle' | 'cropping' | 'uploading';

/** Maps a rejection reason to something a person can act on. */
function friendlyError(status: number, body: { error?: string; reason?: string }): string {
  if (body.error) return body.error;
  if (status === 401) return 'Your session has expired. Sign in again.';
  if (status === 413) return 'You have reached the file limit for this account.';
  if (status === 429) return 'Too many uploads just now. Wait a moment and try again.';
  return 'That upload failed. Try again, or use a different file.';
}

export function PhotoUpload({ currentUrl, onUploaded }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  // Crop state, in display pixels.
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);

  const fileRef = useRef<File | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dragging = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function pick(file: File) {
    setError(null);

    // A cheap client-side check purely for feedback speed. The server repeats it — this
    // exists so a 40 MB file is refused instantly rather than after a slow upload.
    if (!file.type.startsWith('image/')) {
      setError(
        file.type === 'application/pdf'
          ? 'That is a PDF, not an image. Use the CV field below for documents.'
          : 'That file is not an image. Choose a JPEG, PNG, or WebP.',
      );
      return;
    }

    fileRef.current = file;
    setPreview(URL.createObjectURL(file));
    setOffset({ x: 0, y: 0 });
    setZoom(1);
    setPhase('cropping');
  }

  /**
   * Renders the visible crop to a square canvas.
   *
   * Best-effort: if anything here fails, the ORIGINAL file is uploaded instead and the
   * server crops centrally. The upload must not be blocked by a canvas problem.
   */
  const renderCrop = useCallback(async (): Promise<Blob | null> => {
    const img = imgRef.current;
    const box = boxRef.current;
    if (!img || !box) return null;

    try {
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT;
      canvas.height = OUTPUT;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      const boxSize = box.clientWidth;
      const scale = OUTPUT / boxSize;
      const drawn = Math.max(boxSize / img.naturalWidth, boxSize / img.naturalHeight) * zoom;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, OUTPUT, OUTPUT);
      ctx.drawImage(
        img,
        offset.x * scale,
        offset.y * scale,
        img.naturalWidth * drawn * scale,
        img.naturalHeight * drawn * scale,
      );

      return await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/webp', 0.92),
      );
    } catch {
      return null;
    }
  }, [offset, zoom]);

  async function send(body: Blob, filename: string) {
    setPhase('uploading');
    setProgress(0);
    setError(null);

    const form = new FormData();
    form.set('kind', 'photo');
    form.set('file', body, filename);

    // XMLHttpRequest rather than fetch: fetch has no upload progress event, and a
    // multi-megabyte upload with no visible progress reads as a frozen page.
    const result = await new Promise<{ status: number; body: Record<string, unknown> }>(
      (resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/upload');
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        });
        xhr.addEventListener('load', () => {
          let parsed: Record<string, unknown> = {};
          try {
            parsed = JSON.parse(xhr.responseText);
          } catch {
            /* non-JSON error page */
          }
          resolve({ status: xhr.status, body: parsed });
        });
        xhr.addEventListener('error', () => resolve({ status: 0, body: {} }));
        xhr.send(form);
      },
    );

    if (result.status !== 200) {
      setError(friendlyError(result.status, result.body));
      setPhase('cropping');
      return;
    }

    toast.success('Photo updated.');
    setPhase('idle');
    setPreview(null);
    fileRef.current = null;
    onUploaded?.();
  }

  async function upload(useWholeImage = false) {
    const file = fileRef.current;
    if (!file) return;

    if (useWholeImage) {
      await send(file, file.name);
      return;
    }

    const cropped = await renderCrop();
    // Falls back to the original on any canvas failure — the server squares it anyway.
    await send(cropped ?? file, cropped ? 'crop.webp' : file.name);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const step = event.shiftKey ? NUDGE * 3 : NUDGE;
    const moves: Record<string, () => void> = {
      ArrowLeft: () => setOffset((o) => ({ ...o, x: o.x - step })),
      ArrowRight: () => setOffset((o) => ({ ...o, x: o.x + step })),
      ArrowUp: () => setOffset((o) => ({ ...o, y: o.y - step })),
      ArrowDown: () => setOffset((o) => ({ ...o, y: o.y + step })),
      '+': () => setZoom((z) => Math.min(3, z + 0.1)),
      '=': () => setZoom((z) => Math.min(3, z + 0.1)),
      '-': () => setZoom((z) => Math.max(1, z - 0.1)),
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      move();
    }
  }

  async function handleRemove() {
    setConfirmingRemove(false);
    const result = await removeFileAction('photo');
    if (result.ok) {
      toast.success('Photo removed.');
      onUploaded?.();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <section aria-labelledby="photo-heading" className="space-y-4">
      <h3 id="photo-heading" className="text-[1.1rem] leading-snug font-medium">
        Profile photo
      </h3>

      {error ? (
        <p
          role="alert"
          data-testid="photo-error"
          className="rounded-md border border-destructive/35 bg-destructive/8 px-4 py-3 text-[0.875rem] leading-relaxed"
        >
          {error}
        </p>
      ) : null}

      {phase === 'cropping' && preview ? (
        <div className="space-y-4">
          <div
            ref={boxRef}
            role="group"
            aria-label="Position the photo. Arrow keys move it, plus and minus zoom."
            tabIndex={0}
            onKeyDown={onKeyDown}
            onPointerDown={(e) => {
              dragging.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!dragging.current) return;
              setOffset({ x: e.clientX - dragging.current.x, y: e.clientY - dragging.current.y });
            }}
            onPointerUp={() => { dragging.current = null; }}
            className="relative mx-auto aspect-square w-full max-w-[18rem] cursor-move overflow-hidden rounded-lg border border-border bg-surface-sunken outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={preview}
              alt=""
              draggable={false}
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                transformOrigin: 'top left',
              }}
              className="pointer-events-none absolute min-h-full min-w-full max-w-none object-cover"
            />
          </div>

          <p className="text-center text-[0.8rem] text-muted-foreground">
            Drag to position, or focus the box and use the arrow keys. Shift moves further;
            + and &minus; zoom.
          </p>

          <div className="flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => upload(false)}
              className="inline-flex min-h-11 items-center rounded-md bg-primary px-5 text-[0.9rem] font-medium text-primary-foreground transition-colors outline-none hover:bg-primary/92 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Use this crop
            </button>
            {/* The skip: positioning must never be mandatory. */}
            <button
              type="button"
              onClick={() => upload(true)}
              className="inline-flex min-h-11 items-center rounded-md border border-border bg-surface-raised px-5 text-[0.9rem] font-medium transition-colors outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Use the whole image
            </button>
            <button
              type="button"
              onClick={() => { setPhase('idle'); setPreview(null); fileRef.current = null; }}
              className="inline-flex min-h-11 items-center rounded-md px-4 text-[0.9rem] font-medium transition-colors outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {phase === 'uploading' ? (
        <div className="space-y-2">
          <div
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Upload progress"
            className="h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${Math.max(progress, 4)}%` }}
            />
          </div>
          <p aria-live="polite" className="text-[0.85rem] text-muted-foreground">
            Uploading… {progress}%
          </p>
        </div>
      ) : null}

      {phase === 'idle' ? (
        <div className="flex flex-wrap items-center gap-4">
          {currentUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={currentUrl}
              alt="Your current profile photo"
              width={96}
              height={96}
              className="size-24 rounded-lg border border-border object-cover"
            />
          ) : (
            <div className="flex size-24 items-center justify-center rounded-lg border border-dashed border-border text-[0.75rem] text-muted-foreground">
              No photo
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              id="photo-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) pick(file);
                e.target.value = '';
              }}
            />
            <label
              htmlFor="photo-input"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  inputRef.current?.click();
                }
              }}
              className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-border bg-surface-raised px-4 text-[0.9rem] font-medium transition-colors outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {currentUrl ? 'Replace photo' : 'Upload a photo'}
            </label>

            {currentUrl ? (
              confirmingRemove ? (
                <span className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleRemove}
                    className="inline-flex min-h-11 items-center rounded-md bg-destructive px-4 text-[0.9rem] font-medium text-destructive-foreground transition-colors outline-none hover:bg-destructive/90 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Yes, remove
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingRemove(false)}
                    className="inline-flex min-h-11 items-center rounded-md px-3 text-[0.9rem] transition-colors outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Keep it
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingRemove(true)}
                  className="inline-flex min-h-11 items-center rounded-md px-4 text-[0.9rem] font-medium text-destructive transition-colors outline-none hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Remove
                </button>
              )
            ) : null}
          </div>
        </div>
      ) : null}

      <p className="text-[0.8rem] leading-relaxed text-muted-foreground">
        JPEG, PNG, or WebP, up to 5&nbsp;MB. Saved as a 512×512 square. Location data and
        other metadata are stripped automatically.
      </p>
    </section>
  );
}
