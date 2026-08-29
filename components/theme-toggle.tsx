'use client';

import { Moon, Sun, Laptop } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';

const emptySubscribe = () => () => {};

/**
 * Hydration-safe check returning false on SSR and true on client.
 */
function useMounted() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

/**
 * Hydration-safe theme toggle control.
 *
 * Renders a pill button that cycles through Light, Dark, and System modes,
 * with smooth icon transitions and full keyboard accessibility.
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();

  if (!mounted) {
    return (
      <div
        className={`inline-flex h-9 w-9 items-center justify-center rounded-full border border-hairline bg-surface-raised opacity-0 ${className}`}
        aria-hidden="true"
      />
    );
  }

  const cycleTheme = () => {
    if (theme === 'dark') {
      setTheme('light');
    } else if (theme === 'light') {
      setTheme('system');
    } else {
      setTheme('dark');
    }
  };

  const getIcon = () => {
    if (theme === 'dark') return <Moon className="size-4 text-amber-300" />;
    if (theme === 'light') return <Sun className="size-4 text-amber-600" />;
    return <Laptop className="size-4 text-muted-foreground" />;
  };

  const getLabel = () => {
    if (theme === 'dark') return 'Dark mode (click for light)';
    if (theme === 'light') return 'Light mode (click for system)';
    return 'System theme (click for dark)';
  };

  return (
    <button
      type="button"
      onClick={cycleTheme}
      title={getLabel()}
      aria-label={getLabel()}
      className={`inline-flex h-9 items-center gap-2 rounded-full border border-hairline bg-surface-raised px-3 text-[0.8rem] font-medium text-foreground shadow-xs transition-colors hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${className}`}
    >
      <span className="flex items-center justify-center transition-transform duration-200">
        {getIcon()}
      </span>
      <span className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted-foreground">
        {theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'Auto'}
      </span>
    </button>
  );
}
