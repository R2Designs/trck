import { describe, expect, it } from 'vitest';
import {
  chooseSevenSegmentOdometer,
  dashboardReadingCrops,
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
    expect(crops.odometer).toHaveLength(3);
    expect(crops.afe).toHaveLength(3);
  });
});
