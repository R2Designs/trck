/**
 * Illumination handling for face capture.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists
 * ---------------------------------------------------------------------------
 * The drivers using this product are predominantly South Indian, and many have
 * deep skin tones. Face recognition is well documented to perform worse on
 * darker skin, and in a field application like this one the dominant cause is
 * not the model — it is the camera.
 *
 * A phone pointed at someone standing beside a bus, with the sky or a lit
 * depot behind them, meters for the *background*. The face then lands in the
 * bottom few values of the sensor's range, where JPEG quantisation and sensor
 * noise have already destroyed most of the texture a descriptor depends on.
 * The darker the skin, the fewer values the face had to begin with, so the
 * same backlight that mildly degrades a pale face can erase a dark one.
 *
 * Three mitigations, all implemented here:
 *
 *   1. **Measure the face, not the frame.** Every quality signal is computed
 *      inside the face box. A frame that is "bright enough" overall tells us
 *      nothing about the face in the middle of it.
 *   2. **Detect backlight explicitly**, by comparing background luminance to
 *      face luminance, so the guidance can say "move so the light falls on
 *      their face" instead of the useless "too dark".
 *   3. **Normalise before embedding.** CLAHE (contrast-limited adaptive
 *      histogram equalisation) on the luma channel recovers local detail in
 *      an under-exposed face without blowing out a well-exposed one. It is
 *      applied identically at enrolment and at scan time, so the two are
 *      always compared on equal terms — which matters more than the absolute
 *      improvement, because a mismatch between enrolment and scan conditions
 *      is itself a large source of false rejections.
 *
 * None of this makes the underlying model fair on its own. It removes the
 * failure mode this product can actually control, and the accompanying
 * thresholds must still be validated against the real workforce before
 * rollout — see docs/FACE_RECOGNITION.md ("Performance across skin tones").
 */

import type { FrameQualitySignals } from '@domain/face-match.ts';

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Small working size for per-frame measurement: fast enough for live video. */
const MEASURE_WIDTH = 192;

let measureCanvas: HTMLCanvasElement | null = null;

function getMeasureCanvas(width: number, height: number): CanvasRenderingContext2D | null {
  if (!measureCanvas) measureCanvas = document.createElement('canvas');
  measureCanvas.width = width;
  measureCanvas.height = height;
  return measureCanvas.getContext('2d', { willReadFrequently: true });
}

function luma(data: Uint8ClampedArray, index: number): number {
  return (
    0.299 * (data[index] as number) +
    0.587 * (data[index + 1] as number) +
    0.114 * (data[index + 2] as number)
  );
}

interface RegionStats {
  mean: number;
  /** Population standard deviation of luma, 0–255. */
  stdDev: number;
  /** Fraction of pixels at 0–8 or 247–255: information already destroyed. */
  clippedFraction: number;
}

function regionStats(
  data: Uint8ClampedArray,
  width: number,
  box: { x0: number; y0: number; x1: number; y1: number },
): RegionStats {
  let sum = 0;
  let sumSquares = 0;
  let clipped = 0;
  let count = 0;

  for (let y = box.y0; y < box.y1; y += 1) {
    for (let x = box.x0; x < box.x1; x += 1) {
      const value = luma(data, (y * width + x) * 4);
      sum += value;
      sumSquares += value * value;
      if (value <= 8 || value >= 247) clipped += 1;
      count += 1;
    }
  }

  if (count === 0) return { mean: 0, stdDev: 0, clippedFraction: 1 };
  const mean = sum / count;
  const variance = Math.max(0, sumSquares / count - mean * mean);
  return { mean, stdDev: Math.sqrt(variance), clippedFraction: clipped / count };
}

/** Variance of a 3×3 Laplacian — the standard cheap sharpness estimate. */
function laplacianVariance(
  data: Uint8ClampedArray,
  width: number,
  box: { x0: number; y0: number; x1: number; y1: number },
): number {
  let sum = 0;
  let sumSquares = 0;
  let count = 0;

  for (let y = Math.max(1, box.y0); y < box.y1 - 1; y += 1) {
    for (let x = Math.max(1, box.x0); x < box.x1 - 1; x += 1) {
      const centre = luma(data, (y * width + x) * 4);
      const value =
        4 * centre -
        luma(data, (y * width + (x - 1)) * 4) -
        luma(data, (y * width + (x + 1)) * 4) -
        luma(data, ((y - 1) * width + x) * 4) -
        luma(data, ((y + 1) * width + x) * 4);
      sum += value;
      sumSquares += value * value;
      count += 1;
    }
  }

  if (count === 0) return 0;
  const mean = sum / count;
  return Math.max(0, sumSquares / count - mean * mean);
}

/**
 * Measures a frame's usable quality, inside the face box.
 *
 * Returns the signals `assessFrameQuality` consumes. Runs on a ~192 px copy so
 * it is cheap enough to call on every video frame on a low-end Android device.
 */
export function measureFrameQuality(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  faceBox: FaceBox | null,
  faceCount: number,
  detectionScore: number,
  pose: { yawDegrees?: number | null; pitchDegrees?: number | null } = {},
): FrameQualitySignals {
  const base: FrameQualitySignals = {
    faceCount,
    detectionScore,
    faceAreaRatio: 0,
    sharpness: 0,
    faceBrightness: 0,
    faceContrast: 0,
    backlitRatio: null,
    yawDegrees: pose.yawDegrees ?? null,
    pitchDegrees: pose.pitchDegrees ?? null,
  };

  if (!faceBox || sourceWidth <= 0 || sourceHeight <= 0 || faceCount === 0) return base;

  const scale = Math.min(1, MEASURE_WIDTH / sourceWidth);
  const width = Math.max(16, Math.round(sourceWidth * scale));
  const height = Math.max(16, Math.round(sourceHeight * scale));

  const context = getMeasureCanvas(width, height);
  if (!context) {
    // No canvas (very old WebView): fall back to the detector's own opinion
    // rather than blocking the capture outright.
    return {
      ...base,
      faceAreaRatio: (faceBox.width * faceBox.height) / (sourceWidth * sourceHeight),
      sharpness: detectionScore,
      faceBrightness: 0.5,
      faceContrast: 0.3,
    };
  }

  context.drawImage(source, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);

  const clamp = (value: number, max: number) => Math.max(0, Math.min(max, Math.round(value)));
  const face = {
    x0: clamp(faceBox.x * scale, width - 1),
    y0: clamp(faceBox.y * scale, height - 1),
    x1: clamp((faceBox.x + faceBox.width) * scale, width),
    y1: clamp((faceBox.y + faceBox.height) * scale, height),
  };
  if (face.x1 <= face.x0 || face.y1 <= face.y0) return base;

  const faceStats = regionStats(data, width, face);
  const frameStats = regionStats(data, width, { x0: 0, y0: 0, x1: width, y1: height });

  // Background mean, recovered from the frame and face means by area weights.
  const frameArea = width * height;
  const faceArea = (face.x1 - face.x0) * (face.y1 - face.y0);
  const backgroundArea = Math.max(1, frameArea - faceArea);
  const backgroundMean = (frameStats.mean * frameArea - faceStats.mean * faceArea) / backgroundArea;

  const sharpnessRaw = laplacianVariance(data, width, face);

  return {
    faceCount,
    detectionScore,
    faceAreaRatio: (faceBox.width * faceBox.height) / (sourceWidth * sourceHeight),
    // ~500 is a comfortably sharp face at this working size; clamp to 0..1.
    sharpness: Math.min(1, Math.sqrt(sharpnessRaw) / 22),
    faceBrightness: faceStats.mean / 255,
    // ×4 maps a "good" face std-dev (~60/255) onto roughly 0.9.
    faceContrast: Math.min(1, (faceStats.stdDev / 255) * 4),
    backlitRatio: faceStats.mean > 4 ? backgroundMean / faceStats.mean : null,
    yawDegrees: pose.yawDegrees ?? null,
    pitchDegrees: pose.pitchDegrees ?? null,
  };
}

// ---------------------------------------------------------------------------
// CLAHE
// ---------------------------------------------------------------------------

/**
 * Histogram resolution.
 *
 * 64 bins rather than 256: the tiles are small (a few hundred pixels), and a
 * 256-bin histogram over 400 pixels is mostly empty, which makes the clip
 * limit round down to nothing and turns the transform into a no-op. 64 bins
 * over a 6-bit luma quantisation is the usual choice for tiled CLAHE and is
 * well below the noise floor of a phone camera anyway.
 */
const HISTOGRAM_BINS = 64;
const BIN_SHIFT = 2; // 256 levels -> 64 bins

/** Tiles are sized so each holds enough pixels for its histogram to mean something. */
function tileCountFor(width: number, height: number): number {
  return Math.max(2, Math.min(8, Math.floor(Math.min(width, height) / 32)));
}

/**
 * Contrast-limited adaptive histogram equalisation, on the luma channel only.
 *
 * Applied to every face image before it is embedded — at enrolment *and* at
 * scan time. Equalising both sides is the important part: it removes the
 * lighting difference between "enrolled indoors at the depot office" and
 * "scanned outdoors at 7 a.m.", which is a much larger source of false
 * rejections than the absolute exposure of either one.
 *
 * The clip limit is what stops it amplifying sensor noise in the shadows of an
 * already-dark face into texture the descriptor would treat as real.
 */
export function applyClahe(
  imageData: ImageData,
  clipLimit = 3,
  options: { normaliseExposure?: boolean } = {},
): ImageData {
  const { data, width, height } = imageData;
  const tiles = tileCountFor(width, height);
  const tileWidth = Math.max(1, Math.floor(width / tiles));
  const tileHeight = Math.max(1, Math.floor(height / tiles));

  // One cumulative distribution per tile.
  const maps: Uint8Array[] = [];
  for (let ty = 0; ty < tiles; ty += 1) {
    for (let tx = 0; tx < tiles; tx += 1) {
      const x0 = tx * tileWidth;
      const y0 = ty * tileHeight;
      const x1 = tx === tiles - 1 ? width : x0 + tileWidth;
      const y1 = ty === tiles - 1 ? height : y0 + tileHeight;

      const histogram = new Uint32Array(HISTOGRAM_BINS);
      let pixels = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const bin = Math.round(luma(data, (y * width + x) * 4)) >> BIN_SHIFT;
          histogram[bin] = (histogram[bin] as number) + 1;
          pixels += 1;
        }
      }

      // Clip, then redistribute the excess evenly — the "contrast-limited" part.
      // The limit is expressed as a multiple of the *average* bin height, so it
      // stays meaningful whatever the tile size.
      const average = Math.max(1, pixels / HISTOGRAM_BINS);
      const limit = Math.max(2, Math.round(clipLimit * average));
      let excess = 0;
      for (let bin = 0; bin < HISTOGRAM_BINS; bin += 1) {
        const value = histogram[bin] as number;
        if (value > limit) {
          excess += value - limit;
          histogram[bin] = limit;
        }
      }
      const share = excess / HISTOGRAM_BINS;

      const map = new Uint8Array(HISTOGRAM_BINS);
      let cumulative = 0;
      const total = Math.max(1, pixels);
      for (let bin = 0; bin < HISTOGRAM_BINS; bin += 1) {
        cumulative += (histogram[bin] as number) + share;
        map[bin] = Math.max(0, Math.min(255, Math.round((cumulative / total) * 255)));
      }
      maps.push(map);
    }
  }

  const mapAt = (tx: number, ty: number): Uint8Array =>
    maps[
      Math.min(tiles - 1, Math.max(0, ty)) * tiles + Math.min(tiles - 1, Math.max(0, tx))
    ] as Uint8Array;

  const output = new Uint8ClampedArray(data.length);

  for (let y = 0; y < height; y += 1) {
    // Bilinear interpolation between neighbouring tile maps, which is what
    // stops the output showing the tile grid as visible blocks.
    const gy = y / tileHeight - 0.5;
    const ty0 = Math.floor(gy);
    const fy = gy - ty0;

    for (let x = 0; x < width; x += 1) {
      const gx = x / tileWidth - 0.5;
      const tx0 = Math.floor(gx);
      const fx = gx - tx0;

      const index = (y * width + x) * 4;
      const value = Math.round(luma(data, index));
      const bin = value >> BIN_SHIFT;

      const topLeft = mapAt(tx0, ty0)[bin] as number;
      const topRight = mapAt(tx0 + 1, ty0)[bin] as number;
      const bottomLeft = mapAt(tx0, ty0 + 1)[bin] as number;
      const bottomRight = mapAt(tx0 + 1, ty0 + 1)[bin] as number;

      const top = topLeft + (topRight - topLeft) * fx;
      const bottom = bottomLeft + (bottomRight - bottomLeft) * fx;
      const equalised = top + (bottom - top) * fy;

      // Scale the original RGB by the luma change, so skin keeps its hue
      // instead of drifting grey. Recognition uses structure, but the manager
      // also looks at this image to confirm the match, and a colour-shifted
      // face undermines that check.
      const ratio = value > 2 ? equalised / value : 1;
      output[index] = (data[index] as number) * ratio;
      output[index + 1] = (data[index + 1] as number) * ratio;
      output[index + 2] = (data[index + 2] as number) * ratio;
      output[index + 3] = data[index + 3] as number;
    }
  }

  const equalised = new ImageData(output, width, height);
  return options.normaliseExposure === false ? equalised : normaliseExposure(equalised);
}

/**
 * Global exposure correction, applied after CLAHE.
 *
 * CLAHE restores *local* detail but, with a clip limit in place, deliberately
 * leaves a very dark face darker than a very light one — the redistribution
 * that protects against noise amplification also caps how far the histogram
 * travels. That residual offset is exactly the thing that makes an enrolment
 * taken in the depot office and a scan taken in the yard look like different
 * people to a nearest-neighbour matcher.
 *
 * So a single gamma is applied to bring the mean luminance to mid-grey. Gamma
 * rather than a linear gain because it lifts shadows without clipping
 * highlights, and it is clamped so an almost-black frame cannot be stretched
 * into pure noise.
 */
export function normaliseExposure(imageData: ImageData, target = 128): ImageData {
  const { data, width, height } = imageData;

  let sum = 0;
  const pixels = width * height;
  for (let i = 0; i < data.length; i += 4) sum += luma(data, i);
  const mean = sum / Math.max(1, pixels);

  if (mean < 4 || mean > 251) return imageData;

  // Solve mean^gamma == target in normalised space.
  const gamma = Math.log(target / 255) / Math.log(mean / 255);
  const clamped = Math.max(0.45, Math.min(2.2, gamma));
  if (Math.abs(clamped - 1) < 0.02) return imageData;

  // 256-entry lookup table: one pow per level rather than per pixel.
  const table = new Uint8ClampedArray(256);
  for (let value = 0; value < 256; value += 1) {
    table[value] = Math.round(255 * (value / 255) ** clamped);
  }

  const output = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    output[i] = table[data[i] as number] as number;
    output[i + 1] = table[data[i + 1] as number] as number;
    output[i + 2] = table[data[i + 2] as number] as number;
    output[i + 3] = data[i + 3] as number;
  }
  return new ImageData(output, width, height);
}

/**
 * Crops to the face (with margin), normalises illumination and returns a
 * canvas ready to embed. Used by both enrolment and the attendance scanner.
 */
export function prepareFaceCropForRecognition(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  faceBox: FaceBox,
  outputSize = 256,
): HTMLCanvasElement {
  // 35% margin: descriptors improve with some forehead, ears and chin present.
  const margin = 0.35;
  const side = Math.max(faceBox.width, faceBox.height) * (1 + margin * 2);
  const centreX = faceBox.x + faceBox.width / 2;
  const centreY = faceBox.y + faceBox.height / 2;

  const sx = Math.max(0, Math.min(sourceWidth - 1, centreX - side / 2));
  const sy = Math.max(0, Math.min(sourceHeight - 1, centreY - side / 2));
  const sw = Math.min(sourceWidth - sx, side);
  const sh = Math.min(sourceHeight - sy, side);

  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return canvas;

  context.imageSmoothingQuality = 'high';
  context.drawImage(source, sx, sy, sw, sh, 0, 0, outputSize, outputSize);
  context.putImageData(applyClahe(context.getImageData(0, 0, outputSize, outputSize)), 0, 0);

  return canvas;
}
