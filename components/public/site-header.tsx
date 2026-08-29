import Image from 'next/image';
import Link from 'next/link';

import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';

/**
 * Header for every public page.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-hairline bg-background/80 backdrop-blur-lg">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4 py-2.5 sm:py-3">
          {/* TOP-LEFT: Manipal University Jaipur Logo + Faculty Portal Title */}
          <Link
            href="/"
            className="flex items-center gap-3.5 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md shrink-0"
          >
            {/* Manipal University Jaipur Logo (used for both light and dark mode as requested) */}
            <Image
              src="/images/muj-logo.png"
              alt="Manipal University Jaipur"
              width={220}
              height={50}
              priority
              className="h-10 sm:h-12 lg:h-14 w-auto object-contain mix-blend-multiply dark:mix-blend-normal"
            />
            <span className="font-mono text-[0.75rem] uppercase tracking-[0.18em] text-muted-foreground border-l border-hairline pl-3.5 hidden sm:inline-block">
              Faculty Portal
            </span>
          </Link>

          {/* TOP-RIGHT: Navigation, SDC Logo & Actions */}
          <nav aria-label="Site" className="flex items-center gap-3 sm:gap-4">
            <Link
              href="/faculty"
              className="hidden sm:inline-block rounded-md px-3 py-1.5 text-[0.875rem] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              Directory
            </Link>

            <ThemeToggle />

            <Button asChild variant="default" size="sm" className="h-9 text-xs sm:text-sm font-medium">
              <Link href="/login">
                Faculty Sign In
              </Link>
            </Button>

            {/* SDC Logo — Top Right Header Branding */}
            <div className="pl-1 sm:pl-2 border-l border-hairline flex items-center">
              <Image
                src="/images/sdc-logo-light.png"
                alt="SDC - CSE Manipal University Jaipur"
                width={150}
                height={45}
                priority
                className="h-8 sm:h-10 w-auto object-contain dark:hidden mix-blend-multiply"
              />
              <Image
                src="/images/sdc-logo-dark.png"
                alt="SDC - CSE Manipal University Jaipur"
                width={150}
                height={45}
                priority
                className="h-8 sm:h-10 w-auto object-contain hidden dark:block"
              />
            </div>
          </nav>
        </div>
      </div>
    </header>
  );
}
