import { describe, expect, it } from 'vitest';
import { chooseSevenSegmentOdometer } from '@/providers/ocr/tesseractProvider';

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

  it('returns no reading when every candidate moves the odometer backwards', () => {
    expect(
      chooseSevenSegmentOdometer(
        [
          { value: 4718.5, sourceText: '4718.5' },
          { value: 1368.9, sourceText: '1368.9' },
        ],
        54_600,
      ),
    ).toBeNull();
  });
});
