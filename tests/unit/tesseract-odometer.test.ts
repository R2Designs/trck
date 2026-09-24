import { describe, expect, it } from 'vitest';
import {
  chooseSevenSegmentOdometer,
  dashboardReadingCrops,
  parseSevenSegmentAfeText,
} from '@/providers/ocr/tesseractProvider';

describe('chooseSevenSegmentOdometer', () => {
  it('prefers the value agreed on by multiple crop variants', () => {
    expect(
      chooseSevenSegmentOdometer([
        { value: 4718.5, sourceText: '47 185' },
        { value: 4718.5, sourceText: '4718.5' },
        { value: 1368.9, sourceText: '1368.9' },
      ]),
    ).toEqual({ value: 4718.5, sourceText: '47 185' });
  });

  it('uses bus history to reject a nearby trip-meter value', () => {
    expect(
      chooseSevenSegmentOdometer(
        [
          { value: 1368.9, sourceText: '1368.9' },
          { value: 4718.5, sourceText: '4718.5' },
        ],
        4702.4,
      )?.value,
    ).toBe(4718.5);
  });

  it('keeps the best readable value when every candidate moves backwards', () => {
    expect(
      chooseSevenSegmentOdometer(
        [
          { value: 4718.5, sourceText: '4718.5' },
          { value: 1368.9, sourceText: '1368.9' },
        ],
        54_600,
      )?.value,
    ).toBe(4718.5);
  });
});

describe('parseSevenSegmentAfeText', () => {
  it('reads a normal decimal AFE value', () => {
    expect(parseSevenSegmentAfeText('5.6')).toBe(5.6);
  });

  it('drops a trailing unit slash misread as seven', () => {
    expect(parseSevenSegmentAfeText('627')).toBe(6.2);
  });

  it('rejects implausible fuel-efficiency values', () => {
    expect(parseSevenSegmentAfeText('98.3')).toBeNull();
  });
});

describe('dashboardReadingCrops', () => {
  it('anchors both readouts to labels found in a shifted phone photo', () => {
    const crops = dashboardReadingCrops(
      [
        { text: 'ODO', confidence: 0.9, bbox: { x0: 355, y0: 240, x1: 440, y1: 285 } },
        { text: 'AFE', confidence: 0.9, bbox: { x0: 665, y0: 445, x1: 745, y1: 490 } },
      ],
      1920,
      1080,
    );

    expect(crops.odometer[0]).toMatchObject({
      x: expect.closeTo(0.16, 2),
      y: expect.closeTo(0.2, 2),
      width: 0.34,
      height: 0.25,
    });
    expect(crops.afe[0]).toMatchObject({
      x: expect.closeTo(0.32, 2),
      y: expect.closeTo(0.39, 2),
      width: 0.24,
      height: 0.25,
    });
  });

  it('keeps overlapping fallback crops when glare hides the labels', () => {
    const crops = dashboardReadingCrops([], 1920, 1080);
    expect(crops.odometer).toHaveLength(4);
    expect(crops.afe).toHaveLength(5);
    expect(crops.odometer[0]).toEqual({ x: 0.2, y: 0.26, width: 0.23, height: 0.15 });
    expect(crops.afe[0]).toEqual({ x: 0.36, y: 0.42, width: 0.105, height: 0.13 });
    expect(crops.afe[1]).toEqual({ x: 0.42, y: 0.33, width: 0.13, height: 0.16 });
  });
});
