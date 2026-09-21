import { describe, expect, it } from 'vitest';
import { applyClahe } from '@/lib/face-image';

/**
 * These tests are about one thing: whether an under-exposed face keeps enough
 * detail to be recognised. That is the failure mode that hits dark-skinned
 * drivers hardest, so it is asserted rather than assumed.
 */

function syntheticFace(options: {
  width?: number;
  height?: number;
  /** Mean luminance, 0–255. */
  base: number;
  /** Peak-to-peak variation around the mean. */
  amplitude: number;
}): ImageData {
  const width = options.width ?? 64;
  const height = options.height ?? 64;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // A smooth two-dimensional pattern standing in for facial structure.
      const structure = Math.sin((x / width) * Math.PI * 3) * Math.cos((y / height) * Math.PI * 3);
      const value = Math.max(0, Math.min(255, options.base + structure * options.amplitude));
      const index = (y * width + x) * 4;
      data[index] = value;
      data[index + 1] = value * 0.82; // warm skin tone rather than pure grey
      data[index + 2] = value * 0.7;
      data[index + 3] = 255;
    }
  }
  return new ImageData(data, width, height);
}

function lumaStats(image: ImageData): { mean: number; stdDev: number } {
  let sum = 0;
  let sumSquares = 0;
  const count = image.width * image.height;
  for (let i = 0; i < image.data.length; i += 4) {
    const value =
      0.299 * (image.data[i] as number) +
      0.587 * (image.data[i + 1] as number) +
      0.114 * (image.data[i + 2] as number);
    sum += value;
    sumSquares += value * value;
  }
  const mean = sum / count;
  return { mean, stdDev: Math.sqrt(Math.max(0, sumSquares / count - mean * mean)) };
}

describe('applyClahe', () => {
  it('recovers detail from an under-exposed face', () => {
    // A dark face, correctly framed but metered for a bright background:
    // mean luminance 34/255, very little spread.
    const dark = syntheticFace({ base: 34, amplitude: 9 });
    const before = lumaStats(dark);
    const after = lumaStats(applyClahe(dark));

    expect(before.stdDev).toBeLessThan(10);
    expect(after.stdDev).toBeGreaterThan(before.stdDev * 2);
  });

  it('brings a dark face and a light face onto comparable terms', () => {
    // The point of equalising *both* sides: after normalisation the same
    // facial structure should look statistically similar whether it was
    // captured under-exposed or well exposed, so an enrolment taken in the
    // depot office and a scan taken in the yard can be compared without the
    // lighting difference dominating the distance.
    const darkRaw = syntheticFace({ base: 34, amplitude: 9 });
    const lightRaw = syntheticFace({ base: 150, amplitude: 40 });

    const beforeRatio = lumaStats(darkRaw).stdDev / lumaStats(lightRaw).stdDev;
    const dark = lumaStats(applyClahe(darkRaw));
    const light = lumaStats(applyClahe(lightRaw));
    const afterRatio = dark.stdDev / light.stdDev;

    // Mean luminance is brought into line by the exposure pass, so the two
    // faces sit in the same part of the range.
    expect(Math.abs(dark.mean - light.mean)).toBeLessThan(15);

    // The contrast gap narrows, but does not close — and it should not.
    // Normalisation recovers detail that survived the exposure; it cannot
    // invent detail the sensor never recorded. That residual gap is exactly
    // why the capture UI also coaches the manager on lighting.
    expect(afterRatio).toBeGreaterThan(beforeRatio * 1.3);
  });

  it('lifts an under-exposed dark face over the usability threshold', () => {
    // This is the assertion that matters. `assessFrameQuality` blocks a
    // capture below MIN_FACE_CONTRAST (0.16 on its 0..1 scale, which is a luma
    // standard deviation of about 10/255). Before normalisation this face is
    // below that line and would be refused; after it, it is comfortably above.
    const raw = syntheticFace({ base: 34, amplitude: 9 });
    const toFaceContrast = (stdDev: number) => Math.min(1, (stdDev / 255) * 4);

    expect(toFaceContrast(lumaStats(raw).stdDev)).toBeLessThan(0.16);
    expect(toFaceContrast(lumaStats(applyClahe(raw)).stdDev)).toBeGreaterThan(0.16);
  });

  it('does not blow out a face that was already well exposed', () => {
    const good = syntheticFace({ base: 128, amplitude: 45 });
    const after = lumaStats(applyClahe(good));
    // Still a face, not a two-tone silhouette.
    expect(after.stdDev).toBeLessThan(110);
    expect(after.mean).toBeGreaterThan(40);
    expect(after.mean).toBeLessThan(215);
  });

  it('limits amplification so shadow noise is not turned into texture', () => {
    // Flat, essentially information-free input. A naive histogram
    // equalisation would stretch sensor noise across the full range and
    // manufacture "detail" the descriptor would then trust.
    const flat = syntheticFace({ base: 20, amplitude: 1 });
    const after = lumaStats(applyClahe(flat, 2));
    expect(after.stdDev).toBeLessThan(45);
  });

  it('preserves the alpha channel and image dimensions', () => {
    const image = syntheticFace({ base: 60, amplitude: 20, width: 32, height: 48 });
    const result = applyClahe(image);
    expect(result.width).toBe(32);
    expect(result.height).toBe(48);
    expect(result.data[3]).toBe(255);
  });
});
