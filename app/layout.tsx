import type { Metadata, Viewport } from 'next';
import { Geist_Mono, Instrument_Serif, Inter } from 'next/font/google';

import './globals.css';

/** Body grotesque — CLAUDE.md §7. */
const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
});

/** Display serif for faculty names and page headings — CLAUDE.md §7. */
const instrumentSerif = Instrument_Serif({
  variable: '--font-instrument-serif',
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  display: 'swap',
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Faculty Portal',
    template: '%s · Faculty Portal',
  },
  description:
    'Academic profiles, research interests, and publications of the faculty.',
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FAFAF8' },
    { media: '(prefers-color-scheme: dark)', color: '#0F0F0E' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning is required by next-themes: its script writes the theme
    // class on <html> before React hydrates, which is an intentional mismatch.
    //
    // This layout holds ONLY <html>/<body> and the fonts. Providers live in the subtree
    // layouts so that reading the CSP nonce does not make every route dynamic —
    // see components/providers.tsx.
    // The font variable classes go on <html>, NOT <body>.
    //
    // globals.css applies `font-sans` to the `html` element, and `--font-sans` expands to
    // `var(--font-inter), ...`. With the variables declared one level down on <body>, that
    // reference was undefined AT THE HTML ELEMENT, which makes the whole `font-family`
    // declaration invalid at computed-value time — so it resolved to the initial value and
    // <body> inherited it. Every page in the app has been rendering in the browser's
    // default serif since Sprint 1: no Inter body text, and no Instrument Serif on the
    // faculty names the entire type direction is built around (CLAUDE.md §7).
    //
    // Nothing errored, because a font fallback is not an error. It was caught by reading
    // getComputedStyle().fontFamily off a real page and seeing "Times".
    //
    // next-themes writes its own class onto <html> at runtime via classList, which adds to
    // these rather than replacing them.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${instrumentSerif.variable} ${geistMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
