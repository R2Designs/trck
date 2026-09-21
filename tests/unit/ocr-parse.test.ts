import { describe, expect, it } from 'vitest';
import {
  normaliseNumericToken,
  parseDashboardText,
  parseDashboardWords,
  parseNumber,
  parseSevenSegmentOdometerWords,
  parseSevenSegmentRangeWords,
} from '@domain/ocr-parse.ts';
import type { OcrWord } from '@domain/ocr-parse.ts';

const word = (text: string, confidence = 0.8, area?: number): OcrWord => ({
  text,
  confidence,
  bbox: area ? { x0: 0, y0: 0, x1: area, y1: 1 } : undefined,
});

describe('numeric normalisation', () => {
  it('repairs seven-segment glyph confusions inside numbers', () => {
    expect(normaliseNumericToken('86S42')).toBe('86542');
    expect(normaliseNumericToken('8O,542')).toBe('80,542');
    expect(normaliseNumericToken('I23')).toBe('123');
  });

  it('leaves ordinary words alone', () => {
    expect(normaliseNumericToken('RANGE')).toBe('RANGE');
    expect(normaliseNumericToken('ODO')).toBe('ODO');
  });

  it('parses grouped numbers and rejects junk', () => {
    expect(parseNumber('86,542')).toBe(86542);
    expect(parseNumber('86542.5')).toBe(86542.5);
    expect(parseNumber('63%')).toBe(63);
    expect(parseNumber('km')).toBeNull();
    expect(parseNumber('')).toBeNull();
  });
});

describe('parseDashboardWords', () => {
  it('extracts odometer, range and fuel from a labelled digital cluster', () => {
    const result = parseDashboardWords([
      word('ODO'),
      word('86,542', 0.92, 40),
      word('km'),
      word('RANGE'),
      word('312', 0.88, 12),
      word('km'),
      word('FUEL'),
      word('63%', 0.9, 10),
    ]);

    const byField = Object.fromEntries(result.readings.map((r) => [r.field, r]));
    expect(byField.ODOMETER?.value).toBe(86542);
    expect(byField.RANGE_KM?.value).toBe(312);
    expect(byField.FUEL_PERCENT?.value).toBe(63);
    expect(result.missing).toHaveLength(0);
  });

  it('assigns a confidence band the review screen can act on', () => {
    const result = parseDashboardWords([
      word('ODO'),
      word('86542', 0.95, 40),
      word('RANGE'),
      word('312', 0.3, 8),
    ]);
    const odo = result.readings.find((r) => r.field === 'ODOMETER');
    const range = result.readings.find((r) => r.field === 'RANGE_KM');
    expect(odo?.band).toBe('HIGH');
    expect(range?.band).toBe('LOW');
  });

  it('uses the previous odometer to choose between similar candidates', () => {
    const words = [word('86542', 0.7, 30), word('8654', 0.75, 30)];
    const withHint = parseDashboardWords(words, { previousOdometerKm: 86_400 });
    expect(withHint.readings.find((r) => r.field === 'ODOMETER')?.value).toBe(86542);
  });

  it('rejects a candidate that would move the odometer backwards', () => {
    const result = parseDashboardWords([word('ODO'), word('12345', 0.9, 30)], {
      previousOdometerKm: 86_400,
    });
    const odo = result.readings.find((r) => r.field === 'ODOMETER');
    // It may still be the only candidate, but its confidence must collapse so
    // the manager is forced to look at it.
    expect(odo?.confidence ?? 1).toBeLessThan(0.6);
  });

  it('does not mistake the trip meter for the odometer', () => {
    const result = parseDashboardWords(
      [word('TRIP'), word('1284', 0.95, 20), word('ODO'), word('186420', 0.8, 40)],
      { previousOdometerKm: 186_300 },
    );
    expect(result.readings.find((r) => r.field === 'ODOMETER')?.value).toBe(186420);
  });

  it('reports fields it could not read instead of inventing them', () => {
    const result = parseDashboardWords([word('----'), word('ODO'), word('186420', 0.8, 40)]);
    expect(result.missing).toContain('RANGE_KM');
    expect(result.readings.some((r) => r.field === 'FUEL_PERCENT')).toBe(false);
  });

  it('does not mistake an unlabelled gauge tick for range', () => {
    const result = parseDashboardWords([
      word('35', 0.94, 20),
      word('40', 0.92, 20),
      word('ODO'),
      word('54646.7', 0.8, 40),
      word('km'),
    ]);
    expect(result.readings.find((r) => r.field === 'RANGE_KM')).toBeUndefined();
    expect(result.missing).toContain('RANGE_KM');
  });

  it('reassembles an odometer decimal split into adjacent OCR tokens', () => {
    const result = parseDashboardWords([
      word('ODO'),
      word('54646.', 0.86, 40),
      word('7', 0.8, 5),
      word('km'),
    ]);
    expect(result.readings.find((r) => r.field === 'ODOMETER')?.value).toBe(54646.7);
  });

  it('returns nothing at all for an unreadable analogue cluster', () => {
    const result = parseDashboardWords([word('|||'), word('~~'), word('E'), word('F')]);
    expect(result.readings).toHaveLength(0);
    expect(result.missing).toEqual(['ODOMETER', 'RANGE_KM']);
  });

  it('accepts a flat string from engines that do not return words', () => {
    const result = parseDashboardText('ODO 186420 km RANGE 275 km FUEL 58%', 0.9, {
      previousOdometerKm: 186_000,
    });
    const byField = Object.fromEntries(result.readings.map((r) => [r.field, r.value]));
    expect(byField.ODOMETER).toBe(186420);
    expect(byField.RANGE_KM).toBe(275);
    expect(byField.FUEL_PERCENT).toBe(58);
  });

  it('keeps the normalised text for the audit trail', () => {
    const result = parseDashboardText('ODO   186420    km');
    expect(result.normalisedText).toBe('ODO 186420 km');
  });
});

describe('parseSevenSegmentOdometerWords', () => {
  it('reassembles a decimal omitted by a seven-segment OCR model', () => {
    const result = parseSevenSegmentOdometerWords([
      word('00', 0),
      { text: '54646', confidence: 0, bbox: { x0: 21, y0: 20, x1: 158, y1: 69 } },
      { text: '7', confidence: 0, bbox: { x0: 166, y0: 17, x1: 221, y1: 54 } },
    ]);
    expect(result).toEqual({ value: 54646.7, sourceText: '54646 7' });
  });

  it('accepts a decimal emitted in one word', () => {
    expect(parseSevenSegmentOdometerWords([word('54646.7', 0)])?.value).toBe(54646.7);
  });

  it('joins same-line fragments from a photographed seven-segment display', () => {
    const result = parseSevenSegmentOdometerWords([
      { text: '1', confidence: 0, bbox: { x0: 86, y0: 142, x1: 186, y1: 162 } },
      { text: '47', confidence: 0, bbox: { x0: 90, y0: 80, x1: 148, y1: 127 } },
      { text: '185..', confidence: 0, bbox: { x0: 169, y0: 91, x1: 271, y1: 137 } },
    ]);
    expect(result).toEqual({ value: 4718.5, sourceText: '47 185..' });
  });

  it('keeps only one tenths digit when the model also sees part of km', () => {
    const result = parseSevenSegmentOdometerWords([
      { text: '47', confidence: 0, bbox: { x0: 10, y0: 10, x1: 68, y1: 58 } },
      { text: '18.51', confidence: 0, bbox: { x0: 89, y0: 20, x1: 191, y1: 67 } },
    ]);
    expect(result?.value).toBe(4718.5);
  });
});

describe('parseSevenSegmentRangeWords', () => {
  it('reads an explicit decimal from the fixed range crop', () => {
    expect(parseSevenSegmentRangeWords([word('5.6', 0)])?.value).toBe(5.6);
  });

  it('restores a decimal point omitted by the seven-segment model', () => {
    expect(parseSevenSegmentRangeWords([word('54', 0)])?.value).toBe(5.4);
  });
});

describe('dashboard range precision', () => {
  it('keeps the tenths digit from the fixed range display', () => {
    const result = parseDashboardWords([
      word('RANGE', 0.7),
      word('5.6', 0.7),
    ]);

    expect(result.readings.find((reading) => reading.field === 'RANGE_KM')?.value).toBe(5.6);
  });
});
