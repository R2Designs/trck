import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Theme.
 *
 * Three choices, not two: "match device" is the default because a manager who
 * has already told Android they prefer dark should not have to say it again —
 * but an explicit Light or Dark must survive the device disagreeing, which is
 * why `data-theme` on <html> takes priority over the media query in index.css.
 *
 * The initial value is applied by an inline script in `main.tsx` *before* React
 * mounts, so there is no white flash on a dark-themed phone.
 */

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'trck.theme';
export const MOTION_STORAGE_KEY = 'trck.reduce-motion';

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
  reduceMotion: boolean;
  setReduceMotion: (value: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return allowed.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

function prefersDark(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
  );
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'system') return prefersDark() ? 'dark' : 'light';
  return preference;
}

/** Applies the theme to the document. Exported so `main.tsx` can call it early. */
export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference);
  const root = document.documentElement;

  if (preference === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preference);

  root.style.colorScheme = resolved;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', resolved === 'dark' ? '#000001' : '#0b3d2c');

  return resolved;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    readStored(THEME_STORAGE_KEY, ['light', 'dark', 'system'] as const, 'system'),
  );
  const [reduceMotion, setReduceMotionState] = useState<boolean>(
    () => readStored(MOTION_STORAGE_KEY, ['true', 'false'] as const, 'false') === 'true',
  );
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(preference));

  useEffect(() => {
    setResolved(applyTheme(preference));
  }, [preference]);

  // Follow the OS while the preference is "system" — and stop following the
  // moment the user makes an explicit choice.
  useEffect(() => {
    if (preference !== 'system' || typeof window === 'undefined') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => setResolved(applyTheme('system'));
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, [preference]);

  useEffect(() => {
    document.documentElement.setAttribute('data-reduce-motion', String(reduceMotion));
  }, [reduceMotion]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage unavailable: the choice still applies for this session.
    }
  }, []);

  const setReduceMotion = useCallback((value: boolean) => {
    setReduceMotionState(value);
    try {
      localStorage.setItem(MOTION_STORAGE_KEY, String(value));
    } catch {
      /* ignored */
    }
  }, []);

  const value = useMemo(
    () => ({ preference, resolved, setPreference, reduceMotion, setReduceMotion }),
    [preference, resolved, setPreference, reduceMotion, setReduceMotion],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>');
  return context;
}
