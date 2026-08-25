'use client';

/**
 * Last-resort error boundary.
 *
 * Catches a failure in the ROOT layout itself, which is the one case a normal `error.tsx`
 * cannot reach — at that point React has no layout left to render into, so this component
 * has to supply its own `<html>` and `<body>`.
 *
 * Styles are inline rather than Tailwind classes on purpose: if the stylesheet is what
 * failed to load, a class-based fallback renders as unstyled text on white. This one always
 * looks like something.
 *
 * `error.message` is deliberately NOT displayed. In production Next replaces it with a
 * generic string anyway, but a component that renders it would print internals verbatim the
 * first time someone runs a production build locally. The digest is enough to correlate a
 * report with a server log line.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  // Next 16 renamed this prop from `reset` to `retry`. A component still destructuring
  // `reset` gets undefined and the button throws on click — silently, since this page only
  // renders when something has already gone wrong.
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          padding: '2rem',
          background: '#FAFAF8',
          color: '#1A1A18',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
        }}
      >
        <main style={{ maxWidth: '34rem', textAlign: 'left' }}>
          <p
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              fontSize: '0.7rem',
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: '#6B6B63',
              margin: 0,
            }}
          >
            Error
          </p>
          <h1 style={{ fontSize: '1.9rem', lineHeight: 1.15, margin: '1rem 0 0' }}>
            Something went wrong at our end.
          </h1>
          <p style={{ fontSize: '1rem', lineHeight: 1.7, color: '#4A4A44' }}>
            This is not something you did. Try again in a moment — if it keeps happening,
            let the portal administrator know and quote the reference below.
          </p>
          {error.digest ? (
            <p
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                fontSize: '0.8rem',
                color: '#6B6B63',
              }}
            >
              Reference: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={retry}
            style={{
              marginTop: '1.5rem',
              minHeight: '2.5rem',
              padding: '0 1rem',
              borderRadius: '0.375rem',
              border: '1px solid #D6D6CE',
              background: '#FFFFFF',
              color: 'inherit',
              font: 'inherit',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
