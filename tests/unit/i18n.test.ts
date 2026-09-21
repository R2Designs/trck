import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en/translation.json';
import ta from '@/i18n/locales/ta/translation.json';
import te from '@/i18n/locales/te/translation.json';
import kn from '@/i18n/locales/kn/translation.json';
import {
  DEFAULT_LOCALE,
  isAppLocale,
  LANGUAGES,
  resolveInitialLocale,
  suggestLocaleFromBrowser,
} from '@/i18n/languages';

type Json = Record<string, unknown>;

function flatten(node: Json, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of flatten(value as Json, path)) out.set(k, v);
    } else {
      out.set(path, String(value));
    }
  }
  return out;
}

const placeholders = (value: string) =>
  new Set([...value.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1] as string));

const source = flatten(en as Json);
const locales = { ta, te, kn } as Record<string, Json>;

describe('translation completeness', () => {
  it('ships a non-trivial English resource', () => {
    expect(source.size).toBeGreaterThan(500);
  });

  it.each(Object.keys(locales))('%s has every English key', (locale) => {
    const target = flatten(locales[locale] as Json);
    const missing = [...source.keys()].filter((key) => !target.has(key));
    expect(missing, `missing keys in ${locale}: ${missing.slice(0, 10).join(', ')}`).toEqual([]);
  });

  it.each(Object.keys(locales))('%s introduces no keys English lacks', (locale) => {
    const target = flatten(locales[locale] as Json);
    const extra = [...target.keys()].filter((key) => !source.has(key));
    expect(extra).toEqual([]);
  });

  it.each(Object.keys(locales))('%s preserves every interpolation placeholder', (locale) => {
    const target = flatten(locales[locale] as Json);
    const broken: string[] = [];
    for (const [key, value] of source) {
      const expected = placeholders(value);
      const actual = placeholders(target.get(key) ?? '');
      if (expected.size !== actual.size || [...expected].some((p) => !actual.has(p))) {
        broken.push(key);
      }
    }
    expect(broken, `placeholder mismatch in ${locale}: ${broken.join(', ')}`).toEqual([]);
  });

  it('never leaves a raw key visible: every value is a real string', () => {
    for (const [key, value] of source) {
      expect(value.trim(), `empty value for ${key}`).not.toBe('');
      expect(value, `value for ${key} looks like a key`).not.toMatch(/^[a-z]+(\.[a-zA-Z]+){2,}$/);
    }
  });

  it('uses no accusatory vocabulary anywhere in the product copy', () => {
    // The product surfaces anomalies; humans make judgements. This is a
    // product principle, so it is enforced by a test rather than a review note.
    const banned = /\b(fraud|fraudulent|theft|thief|stole|stealing|culprit|guilty)\b/i;
    for (const [key, value] of source) {
      expect(value, `accusatory wording in ${key}`).not.toMatch(banned);
    }
  });
});

describe('locale resolution', () => {
  it('recognises exactly the four shipped languages', () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual(['en', 'ta', 'te', 'kn']);
    expect(isAppLocale('ta')).toBe(true);
    expect(isAppLocale('hi')).toBe(false);
    expect(isAppLocale(undefined)).toBe(false);
  });

  it('shows every language under its own name', () => {
    expect(LANGUAGES.map((l) => l.label)).toEqual(['English', 'தமிழ்', 'తెలుగు', 'ಕನ್ನಡ']);
  });

  it('suggests a language from the browser, including regional tags', () => {
    expect(suggestLocaleFromBrowser(['ta-IN', 'en-GB'])).toBe('ta');
    expect(suggestLocaleFromBrowser(['fr-FR'])).toBe(DEFAULT_LOCALE);
    expect(suggestLocaleFromBrowser([])).toBe(DEFAULT_LOCALE);
  });

  it('never lets the browser override a stored choice', () => {
    // Someone who deliberately picked English on a Tamil phone keeps English.
    expect(resolveInitialLocale({ profileLocale: 'en', browserLanguages: ['ta-IN'] })).toBe('en');
    expect(resolveInitialLocale({ storedLocale: 'kn', browserLanguages: ['en-US'] })).toBe('kn');
  });

  it('prefers the profile over the device when both exist', () => {
    expect(
      resolveInitialLocale({ profileLocale: 'te', storedLocale: 'ta', browserLanguages: ['en'] }),
    ).toBe('te');
  });

  it('ignores a stored value that is not a supported language', () => {
    expect(resolveInitialLocale({ storedLocale: 'zz', browserLanguages: ['kn-IN'] })).toBe('kn');
  });
});
