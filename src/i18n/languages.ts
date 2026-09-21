import type { AppLocale } from '@domain/types.ts';
import { APP_LOCALES } from '@domain/types.ts';

/**
 * The shipped languages.
 *
 * `label` is the language's *endonym* — what its own speakers call it — because
 * a driver's supervisor looking for Tamil is looking for "தமிழ்", not "Tamil".
 * These strings are therefore never translated.
 */
export interface LanguageOption {
  code: AppLocale;
  label: string;
  englishName: string;
  /** Unicode script, used to decide which font subset to load. */
  script: 'latin' | 'tamil' | 'telugu' | 'kannada' | 'devanagari';
  /** BCP-47 tag handed to Intl for dates, numbers and relative times. */
  intlLocale: string;
}

export const LANGUAGES: readonly LanguageOption[] = [
  { code: 'en', label: 'English', englishName: 'English', script: 'latin', intlLocale: 'en-IN' },
  { code: 'ta', label: 'தமிழ்', englishName: 'Tamil', script: 'tamil', intlLocale: 'ta-IN' },
  { code: 'te', label: 'తెలుగు', englishName: 'Telugu', script: 'telugu', intlLocale: 'te-IN' },
  { code: 'kn', label: 'ಕನ್ನಡ', englishName: 'Kannada', script: 'kannada', intlLocale: 'kn-IN' },
  { code: 'hi', label: 'हिन्दी', englishName: 'Hindi', script: 'devanagari', intlLocale: 'hi-IN' },
];

export const DEFAULT_LOCALE: AppLocale = 'en';

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (APP_LOCALES as readonly string[]).includes(value);
}

export function languageOption(code: AppLocale): LanguageOption {
  return LANGUAGES.find((l) => l.code === code) ?? (LANGUAGES[0] as LanguageOption);
}

/**
 * Best initial guess from the browser — a *suggestion only*.
 * A stored preference always wins; see `resolveInitialLocale`.
 */
export function suggestLocaleFromBrowser(
  languages: readonly string[] = typeof navigator === 'undefined'
    ? []
    : (navigator.languages ?? []),
): AppLocale {
  for (const tag of languages) {
    const base = tag.toLowerCase().split('-')[0];
    if (isAppLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

/**
 * Resolution order, and the reason for each step:
 *   1. the locale last chosen on this device — the user's most recent explicit choice;
 *   2. the locale stored on the user's profile — a durable cross-device fallback;
 *   3. the browser's preference — a first-run suggestion only;
 *   4. English.
 *
 * Step 3 must never override steps 1 or 2. Someone who deliberately chose
 * English on a Tamil-configured phone keeps English.
 */
export function resolveInitialLocale(options: {
  profileLocale?: string | null;
  storedLocale?: string | null;
  browserLanguages?: readonly string[];
}): AppLocale {
  if (isAppLocale(options.storedLocale)) return options.storedLocale;
  if (isAppLocale(options.profileLocale)) return options.profileLocale;
  return suggestLocaleFromBrowser(options.browserLanguages);
}
