/**
 * Script-aware font loading.
 *
 * Many low-end Android ROMs ship incomplete Tamil, Telugu and Kannada glyph
 * coverage, which shows up as tofu boxes or broken vowel signs. We self-host
 * Noto (SIL Open Font Licence) rather than trusting the device — but we only
 * fetch the subset the selected language actually needs, because each Indic
 * subset is ~60 KB and a manager should only download the script they use.
 *
 * Fontsource ships the @font-face rules as plain CSS, so a dynamic import is
 * all that is required; Vite turns each into its own lazily-loaded stylesheet.
 */

import type { AppLocale } from '@domain/types.ts';
import { logger } from '@/lib/logger';
import { languageOption } from './languages';

const loaded = new Set<string>();

async function loadScript(script: string): Promise<void> {
  if (loaded.has(script)) return;
  loaded.add(script);

  try {
    switch (script) {
      case 'tamil':
        await Promise.all([
          import('@fontsource/noto-sans-tamil/tamil-400.css'),
          import('@fontsource/noto-sans-tamil/tamil-600.css'),
        ]);
        break;
      case 'telugu':
        await Promise.all([
          import('@fontsource/noto-sans-telugu/telugu-400.css'),
          import('@fontsource/noto-sans-telugu/telugu-600.css'),
        ]);
        break;
      case 'kannada':
        await Promise.all([
          import('@fontsource/noto-sans-kannada/kannada-400.css'),
          import('@fontsource/noto-sans-kannada/kannada-600.css'),
        ]);
        break;
      case 'devanagari':
        await Promise.all([
          import('@fontsource/noto-sans/devanagari-400.css'),
          import('@fontsource/noto-sans/devanagari-600.css'),
        ]);
        break;
      default:
        break;
    }
  } catch (error) {
    // A missing font is a degraded experience, never a broken screen: the
    // device's own fallback font takes over.
    loaded.delete(script);
    logger.warn('Font subset failed to load', { script, error });
  }
}

/** Loads the glyphs the given language needs. Safe to call repeatedly. */
export async function ensureFontsFor(locale: AppLocale): Promise<void> {
  await loadScript(languageOption(locale).script);
}
