/**
 * Dashboard OCR parsing.
 *
 * The OCR *engine* (Tesseract today, something else tomorrow) only ever returns
 * text and per-word confidence. Turning "0DO 86,5A2 km" into "odometer =
 * 86542, confidence 0.71" is a domain problem, not an engine problem, so it
 * lives here — independently testable, and shared by the browser and the Edge
 * Function.
 *
 * The parser is deliberately conservative. When it is unsure it says so with a
 * low confidence, and the review screen makes the manager look. It never
 * invents a value to avoid an empty field.
 */

import type { ConfidenceBand, ReadingField } from './types.ts';
import { confidenceBand, DEFAULT_THRESHOLDS } from './thresholds.ts';
import type { Thresholds } from './thresholds.ts';

export interface OcrWord {
  text: string;
  /** 0..1 as reported by the engine. */
  confidence: number;
  /** Optional bounding box, used to prefer the largest digits on the cluster. */
  bbox?: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrParseHints {
  /** Last known odometer for this bus; disambiguates 86542 from 8654. */
  previousOdometerKm?: number | null;
  /** Tank capacity is irrelevant here but fuel type is not: EVs show % and range. */
  isElectric?: boolean;
}

export interface ParsedReading {
  field: ReadingField;
  value: number;
  confidence: number;
  band: ConfidenceBand;
  /** The raw token(s) the value came from, shown next to the correction input. */
  sourceText: string;
}

export interface DashboardParseResult {
  readings: ParsedReading[];
  /** Fields the parser could not find at all — the UI asks for them by hand. */
  missing: ReadingField[];
  /** Normalised full text, retained for the audit trail. */
  normalisedText: string;
}

/**
 * Seven-segment models often return the tenths digit as a second word because
 * the decimal point is a disconnected dot (`54646 7`). Reassemble only when
 * the geometry shows a single digit immediately to the right of a 4–7 digit
 * odometer. This is intentionally separate from the generic parser: ordinary
 * dashboard numbers must never be joined merely because they are adjacent.
 */
export function parseSevenSegmentOdometerWords(
  words: readonly OcrWord[],
): { value: number; sourceText: string } | null {
  const cleaned = words.map((word, index) => ({
    word,
    index,
    text: normaliseNumericToken(word.text).replace(/[^0-9.,]/g, ''),
  }));

  const direct = cleaned
    .filter((item) => /^\d{4,7}[.,]\d$/.test(item.text))
    .sort((a, b) => b.text.length - a.text.length)[0];
  if (direct) {
    const value = parseNumber(direct.text);
    return value == null ? null : { value, sourceText: direct.word.text };
  }

  const positioned = cleaned
    .filter((item) => item.text !== '' && item.word.bbox)
    .sort((a, b) => (a.word.bbox?.x0 ?? 0) - (b.word.bbox?.x0 ?? 0));
  const groups: (typeof positioned)[] = [];
  for (let start = 0; start < positioned.length; start += 1) {
    const group = [positioned[start] as (typeof positioned)[number]];
    for (let index = start + 1; index < positioned.length; index += 1) {
      const previous = group[group.length - 1];
      const next = positioned[index];
      if (!previous?.word.bbox || !next?.word.bbox) continue;
      const previousHeight = Math.max(1, previous.word.bbox.y1 - previous.word.bbox.y0);
      const nextHeight = Math.max(1, next.word.bbox.y1 - next.word.bbox.y0);
      const overlap =
        Math.min(previous.word.bbox.y1, next.word.bbox.y1) -
        Math.max(previous.word.bbox.y0, next.word.bbox.y0);
      const gap = next.word.bbox.x0 - previous.word.bbox.x1;
      if (
        gap >= -2 &&
        gap <= Math.max(previousHeight, nextHeight) &&
        overlap / Math.min(previousHeight, nextHeight) >= 0.35
      ) {
        group.push(next);
      }
    }
    groups.push(group);
  }

  const reconstructed = groups
    .map((group) => {
      const sourceText = group.map((item) => item.word.text.trim()).join(' ');
      const combined = group.map((item) => item.text).join('');
      const digits = combined.replace(/\D/g, '');
      if (digits.length < 5 || digits.length > 8) return null;

      const separatorIndex = combined.search(/[.,]/);
      const digitsBeforeSeparator =
        separatorIndex < 0 ? 0 : combined.slice(0, separatorIndex).replace(/\D/g, '').length;
      const digitsAfterSeparator =
        separatorIndex < 0 ? 0 : combined.slice(separatorIndex + 1).replace(/\D/g, '').length;
      let whole: string;
      let tenth: string;
      if (digitsBeforeSeparator >= 4 && digitsBeforeSeparator <= 7 && digitsAfterSeparator > 0) {
        whole = digits.slice(0, digitsBeforeSeparator);
        tenth = digits[digitsBeforeSeparator] ?? '';
      } else {
        whole = digits.slice(0, -1);
        tenth = digits.slice(-1);
      }
      if (whole.length < 4 || whole.length > 7 || tenth === '') return null;
      return { value: Number(`${whole}.${tenth}`), sourceText, digitCount: digits.length };
    })
    .filter((item): item is NonNullable<typeof item> => item != null)
    .sort((a, b) => b.digitCount - a.digitCount)[0];
  if (reconstructed) {
    return { value: reconstructed.value, sourceText: reconstructed.sourceText };
  }

  const bases = cleaned
    .filter((item) => /^\d{4,7}$/.test(item.text))
    .sort((a, b) => b.text.length - a.text.length);

  for (const base of bases) {
    const suffixes = cleaned.filter((item) => /^\d$/.test(item.text) && item.index > base.index);
    for (const suffix of suffixes) {
      if (base.word.bbox && suffix.word.bbox) {
        const height = Math.max(1, base.word.bbox.y1 - base.word.bbox.y0);
        const gap = suffix.word.bbox.x0 - base.word.bbox.x1;
        const baseCentre = (base.word.bbox.y0 + base.word.bbox.y1) / 2;
        const suffixCentre = (suffix.word.bbox.y0 + suffix.word.bbox.y1) / 2;
        if (gap < -2 || gap > height || Math.abs(baseCentre - suffixCentre) > height * 0.8)
          continue;
      } else if (suffix.index !== base.index + 1) {
        continue;
      }

      return {
        value: Number(`${base.text}.${suffix.text}`),
        sourceText: `${base.word.text} ${suffix.word.text}`,
      };
    }
  }

  return null;
}

/**
 * Characters seven-segment displays and low-light photos routinely confuse.
 * Applied only inside tokens that are already mostly digits, so ordinary words
 * such as "RANGE" are never mangled.
 */
const DIGIT_CONFUSIONS: Record<string, string> = {
  O: '0',
  o: '0',
  Q: '0',
  D: '0',
  I: '1',
  l: '1',
  '|': '1',
  i: '1',
  Z: '2',
  z: '2',
  S: '5',
  s: '5',
  b: '6',
  G: '6',
  T: '7',
  B: '8',
  g: '9',
  q: '9',
};

const ODOMETER_LABELS = ['odo', 'odometer', 'total', 'km total'];
// This fleet's dashboard exposes average fuel efficiency (AFE), not distance
// to empty. The persisted field name remains RANGE_KM for compatibility with
// the deployed schema, but its product meaning is AFE in km/L.
const AFE_LABELS = ['afe', 'average fuel efficiency', 'km/l', 'kmpl'];
const FUEL_LABELS = ['fuel', 'ful', 'tank', 'level'];
const TRIP_LABELS = ['trip', 'tripa', 'trip a', 'trip b', 'tr1', 'tr2'];

function looksNumeric(token: string): boolean {
  const digits = (token.match(/[0-9]/g) ?? []).length;
  return digits > 0 && digits >= token.replace(/[.,%\s]/g, '').length / 2;
}

/** Repairs digit-like glyphs inside a mostly-numeric token. */
export function normaliseNumericToken(token: string): string {
  if (!looksNumeric(token)) return token;
  return token
    .split('')
    .map((ch) => DIGIT_CONFUSIONS[ch] ?? ch)
    .join('');
}

/** Strips grouping separators and returns a finite number, or null. */
export function parseNumber(token: string): number | null {
  const cleaned = normaliseNumericToken(token)
    .replace(/[^0-9.,]/g, '')
    // Indian and Western grouping both appear on imported clusters.
    .replace(/,/g, '');
  if (cleaned === '' || cleaned === '.') return null;
  // A trailing ".5" on an odometer is a tenth, not a thousands separator.
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

function labelledNearby(
  words: readonly OcrWord[],
  index: number,
  labels: readonly string[],
): boolean {
  const window = words
    .slice(Math.max(0, index - 3), index + 3)
    .map((w) => w.text.toLowerCase())
    .join(' ');
  return labels.some((label) => window.includes(label));
}

function areaOf(word: OcrWord): number {
  if (!word.bbox) return 0;
  return Math.max(0, word.bbox.x1 - word.bbox.x0) * Math.max(0, word.bbox.y1 - word.bbox.y0);
}

/**
 * Extracts odometer, AFE and fuel percentage from a bag of OCR words.
 *
 * Strategy, in order:
 *   1. A value sitting next to its own label wins outright.
 *   2. Otherwise the shape of the number decides: 4–7 digits is an odometer,
 *      a decimal next to "AFE" is km/L, 0–100 before "%" is a fuel level.
 *   3. Odometer candidates are scored against the previous known reading —
 *      buses do not lose kilometres, and they rarely gain thousands in a day.
 */
export function parseDashboardWords(
  words: readonly OcrWord[],
  hints: OcrParseHints = {},
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): DashboardParseResult {
  const normalisedText = words
    .map((w) => w.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const readings: ParsedReading[] = [];

  const maxArea = words.reduce((max, w) => Math.max(max, areaOf(w)), 0);

  interface Candidate {
    value: number;
    confidence: number;
    text: string;
    index: number;
    area: number;
  }

  const numeric: Candidate[] = [];
  words.forEach((word, index) => {
    const value = parseNumber(word.text);
    if (value == null) return;
    numeric.push({
      value,
      confidence: Math.min(1, Math.max(0, word.confidence)),
      text: word.text,
      index,
      area: areaOf(word),
    });

    // A decimal odometer is sometimes split by OCR into `54646.` and `7`.
    // Preserve that decimal instead of silently treating the first token as a
    // whole-kilometre reading. Only join when punctuation makes the intent
    // unambiguous; joining arbitrary neighbouring numbers would turn gauge
    // ticks such as `35 40` into a fake odometer.
    const next = words[index + 1];
    if (next && /[.,]/.test(word.text) && /^\d{1,2}(?:km)?$/i.test(next.text)) {
      const joinedText = `${word.text}${next.text}`;
      const joinedValue = parseNumber(joinedText);
      if (joinedValue != null) {
        // The token ending in a decimal mark is incomplete; do not let its
        // slightly higher confidence beat the reconstructed value.
        if (/[.,]$/.test(word.text)) numeric.pop();
        numeric.push({
          value: joinedValue,
          confidence: Math.min(word.confidence, next.confidence),
          text: joinedText,
          index,
          area: areaOf(word) + areaOf(next),
        });
      }
    }
  });

  // --- Fuel percentage ------------------------------------------------------
  const fuelCandidates = numeric.filter(
    (c) =>
      c.value >= 0 &&
      c.value <= 100 &&
      (/%/.test(c.text) ||
        (labelledNearby(words, c.index, FUEL_LABELS) &&
          !labelledNearby(words, c.index, AFE_LABELS))),
  );
  const fuel = fuelCandidates.sort((a, b) => b.confidence - a.confidence)[0];
  if (fuel) {
    const boost = /%/.test(fuel.text) ? 0.1 : 0;
    const confidence = Math.min(1, fuel.confidence + boost);
    readings.push({
      field: 'FUEL_PERCENT',
      value: Math.round(fuel.value),
      confidence,
      band: confidenceBand(confidence, thresholds),
      sourceText: fuel.text,
    });
  }

  // --- Odometer -------------------------------------------------------------
  const previous = hints.previousOdometerKm ?? null;
  const odometerCandidates = numeric
    .filter((c) => Number.isInteger(c.value) || c.value % 1 !== 0)
    .filter((c) => {
      const digits = Math.floor(Math.abs(c.value)).toString().length;
      return digits >= 4 && digits <= 7;
    })
    .map((c) => {
      let score = c.confidence;
      if (labelledNearby(words, c.index, ODOMETER_LABELS)) score += 0.25;
      if (labelledNearby(words, c.index, TRIP_LABELS)) score -= 0.35;
      // The odometer is usually the physically largest number on the cluster.
      if (maxArea > 0 && c.area >= maxArea * 0.7) score += 0.1;
      if (previous != null) {
        const delta = c.value - previous;
        // Odometers do not run backwards. A candidate that claims otherwise is
        // capped rather than merely penalised, so no amount of label or size
        // bonus can push an impossible reading back into the "high confidence"
        // band and past the manager without a second look.
        if (delta < -5) score = Math.min(score, 0.2);
        else if (delta >= 0 && delta <= 600)
          score += 0.3; // a plausible day
        else if (delta > 5000) score = Math.min(score, 0.45);
      }
      return { ...c, score };
    })
    .sort((a, b) => b.score - a.score);

  const odometer = odometerCandidates[0];
  if (odometer) {
    const confidence = Math.min(1, Math.max(0, odometer.score));
    readings.push({
      field: 'ODOMETER',
      value: Math.round(odometer.value * 10) / 10,
      confidence,
      band: confidenceBand(confidence, thresholds),
      sourceText: odometer.text,
    });
  }

  // --- Average fuel efficiency (AFE) -----------------------------------------
  const odometerIndex = odometer?.index;
  const afeCandidates = numeric
    .filter((c) => c.index !== odometerIndex)
    .filter((c) => c.value >= 0 && c.value <= 1500)
    // A bare number on a dashboard is commonly a speedometer/tachometer tick.
    // Require semantic evidence rather than presenting a confident invention.
    .filter((c) => labelledNearby(words, c.index, AFE_LABELS))
    .map((c) => {
      let score = c.confidence * 0.8;
      if (labelledNearby(words, c.index, AFE_LABELS)) score += 0.35;
      const digits = Math.floor(Math.abs(c.value)).toString().length;
      if (digits >= 4) score -= 0.4;
      if (/%/.test(c.text)) score -= 0.5;
      return { ...c, score };
    })
    .filter((c) => c.score > 0.25)
    .sort((a, b) => b.score - a.score);

  const afe = afeCandidates[0];
  if (afe) {
    const confidence = Math.min(1, Math.max(0, afe.score));
    readings.push({
      field: 'RANGE_KM',
      value: Math.round(afe.value * 10) / 10,
      confidence,
      band: confidenceBand(confidence, thresholds),
      sourceText: afe.text,
    });
  }

  const found = new Set(readings.map((r) => r.field));
  const wanted: ReadingField[] = ['ODOMETER', 'RANGE_KM'];

  return {
    readings,
    missing: wanted.filter((field) => !found.has(field)),
    normalisedText,
  };
}

/** Convenience wrapper for engines that only return a flat string. */
export function parseDashboardText(
  text: string,
  confidence = 0.5,
  hints: OcrParseHints = {},
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): DashboardParseResult {
  const words: OcrWord[] = text
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => ({ text: token, confidence }));
  return parseDashboardWords(words, hints, thresholds);
}
