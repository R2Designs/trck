/**
 * i18n bootstrap.
 *
 * Design decisions worth knowing:
 *
 *  • **One namespace, one file per language.** Only the active language's resource is
 *    fetched (dynamic `import`), so a Tamil user never downloads Kannada.
 *  • **English is the fallback.** A missing key renders the English sentence,
 *    never the raw key — a manager must never see `attendance.markPresent`.
 *  • **The stored choice is authoritative.** The browser's language is used
 *    once, as a suggestion, and never overrides a choice already made.
 *  • **Formatting is locale-aware, content is not.** Dates, numbers and
 *    percentages go through Intl; names and registration numbers never do.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { AppLocale } from '@domain/types.ts';
import { logger } from '@/lib/logger';
import { isProduction } from '@/app/config';
import { DEFAULT_LOCALE, languageOption, LANGUAGES, resolveInitialLocale } from './languages';
import { ensureFontsFor } from './fonts';
import enTranslation from './locales/en/translation.json';

export const LOCALE_STORAGE_KEY = 'trck.locale';

const loaders: Record<AppLocale, () => Promise<{ default: Record<string, unknown> }>> = {
  en: async () => ({ default: enTranslation as Record<string, unknown> }),
  ta: () => import('./locales/ta/translation.json'),
  te: () => import('./locales/te/translation.json'),
  kn: () => import('./locales/kn/translation.json'),
  hi: () => import('./locales/hi/translation.json'),
};

export function readStoredLocale(): string | null {
  try {
    return localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    // Private mode, blocked storage — fall through to the browser suggestion.
    return null;
  }
}

export function persistLocale(locale: AppLocale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Non-fatal: the profile copy is the durable one.
  }
}

async function ensureResources(locale: AppLocale): Promise<void> {
  if (i18n.hasResourceBundle(locale, 'translation')) return;
  const module = await loaders[locale]();
  i18n.addResourceBundle(locale, 'translation', module.default, true, true);
}

/**
 * Switches language everywhere: resources, fonts, `<html lang>` and Intl
 * formatters. Callers persist the choice to the profile separately, because
 * that needs a network round trip and this must not wait for one.
 */
export async function changeLanguage(locale: AppLocale): Promise<void> {
  await Promise.all([ensureResources(locale), ensureFontsFor(locale)]);
  await i18n.changeLanguage(locale);
  persistLocale(locale);

  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
  }
}

export async function initI18n(profileLocale?: string | null): Promise<typeof i18n> {
  const initial = resolveInitialLocale({
    profileLocale,
    storedLocale: readStoredLocale(),
  });

  await i18n.use(initReactI18next).init({
    resources: { en: { translation: enTranslation } },
    lng: initial,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: LANGUAGES.map((l) => l.code),
    defaultNS: 'translation',
    ns: ['translation'],
    // React already escapes everything it renders.
    interpolation: { escapeValue: false },
    returnNull: false,
    // In development, shout about a key that has no translation anywhere.
    saveMissing: !isProduction,
    missingKeyHandler: isProduction
      ? undefined
      : (lngs, ns, key) => logger.warn('Missing translation key', { lngs, ns, key }),
    react: { useSuspense: false },
  });

  if (initial !== DEFAULT_LOCALE) {
    await ensureResources(initial);
    await i18n.changeLanguage(initial);
  }
  await ensureFontsFor(initial);

  if (typeof document !== 'undefined') {
    document.documentElement.lang = initial;
  }

  return i18n;
}

export function currentLocale(): AppLocale {
  const lng = i18n.resolvedLanguage ?? i18n.language ?? DEFAULT_LOCALE;
  return (LANGUAGES.find((l) => l.code === lng)?.code ?? DEFAULT_LOCALE) as AppLocale;
}

export function currentIntlLocale(): string {
  return languageOption(currentLocale()).intlLocale;
}

export { i18n };
export * from './languages';
