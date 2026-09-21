/**
 * Translation parity check.
 *
 * Fails the build when a key that exists in English is missing from a shipped
 * translation — or when a translation drops an interpolation
 * placeholder, which produces a sentence with a hole in it at runtime.
 *
 *   npm run i18n:check
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const localesDir = resolve(here, '../src/i18n/locales');

const SOURCE = 'en';
const TARGETS = ['ta', 'te', 'kn', 'hi'] as const;

type Json = { [key: string]: Json | string | number | boolean | null };

function load(locale: string): Json {
  return JSON.parse(readFileSync(resolve(localesDir, locale, 'translation.json'), 'utf8')) as Json;
}

function flatten(node: Json, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') {
      for (const [k, v] of flatten(value as Json, path)) out.set(k, v);
    } else {
      out.set(path, String(value));
    }
  }
  return out;
}

function placeholders(value: string): Set<string> {
  return new Set([...value.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1] as string));
}

const source = flatten(load(SOURCE));
let failures = 0;

console.log(`\ni18n parity check — ${source.size} keys in "${SOURCE}"\n`);

for (const locale of TARGETS) {
  const target = flatten(load(locale));
  const missing: string[] = [];
  const extra: string[] = [];
  const mismatched: string[] = [];
  const untranslated: string[] = [];

  for (const [key, sourceValue] of source) {
    const value = target.get(key);
    if (value === undefined) {
      missing.push(key);
      continue;
    }

    const expected = placeholders(sourceValue);
    const actual = placeholders(value);
    if (expected.size !== actual.size || [...expected].some((p) => !actual.has(p))) {
      mismatched.push(
        `${key}  expected {${[...expected].join(', ')}} got {${[...actual].join(', ')}}`,
      );
    }

    // Identical strings are fine for product names, codes and symbols, but a
    // whole sentence left in English is almost certainly an oversight.
    if (value === sourceValue && sourceValue.length > 24 && /\s/.test(sourceValue)) {
      untranslated.push(key);
    }
  }

  for (const key of target.keys()) if (!source.has(key)) extra.push(key);

  const ok = missing.length === 0 && mismatched.length === 0;
  console.log(`${ok ? '✓' : '✗'} ${locale}: ${target.size} keys`);
  if (missing.length) {
    failures += 1;
    console.log(`   missing (${missing.length}):`);
    for (const key of missing.slice(0, 25)) console.log(`     - ${key}`);
    if (missing.length > 25) console.log(`     … and ${missing.length - 25} more`);
  }
  if (mismatched.length) {
    failures += 1;
    console.log(`   placeholder mismatch (${mismatched.length}):`);
    for (const line of mismatched.slice(0, 15)) console.log(`     - ${line}`);
  }
  // Extra and untranslated keys are reported but do not fail the build: the
  // first is harmless, the second is a translation-quality signal for review.
  if (extra.length) console.log(`   note: ${extra.length} key(s) not present in ${SOURCE}`);
  if (untranslated.length) {
    console.log(
      `   note: ${untranslated.length} string(s) identical to English — worth a native review`,
    );
  }
}

console.log('');
if (failures > 0) {
  console.error('i18n parity check failed.\n');
  process.exit(1);
}
console.log('All locales are complete.\n');
