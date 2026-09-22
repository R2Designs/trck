/**
 * Image preparation for upload.
 *
 * A modern Android camera produces 8–12 MP JPEGs of 4–6 MB. Uploading that
 * from a depot yard on a weak connection is both slow and pointless: face
 * recognition needs a well-lit ~500 px face, and Tesseract reads an odometer
 * better at 1600 px than at 4000 px.
 *
 * So every image is:
 *   1. decoded once,
 *   2. downscaled to a purpose-specific maximum edge,
 *   3. re-encoded as JPEG at a quality tuned for that purpose,
 *   4. stripped of EXIF — which is what carries GPS coordinates, device serial
 *      numbers and timestamps we have no business storing.
 *
 * Re-encoding through a canvas drops all metadata as a side effect; that is
 * relied on deliberately and asserted in the tests.
 */

import { AppError } from './errors';
import { logger } from './logger';

export type ImagePurpose = 'face' | 'dashboard';

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
  byteSize: number;
  contentType: 'image/jpeg';
  /** Stable content hash, used to spot a dashboard photo submitted twice. */
  hash: string;
  /** Object URL for preview. The caller owns revocation. */
  previewUrl: string;
}

interface PurposeProfile {
  maxEdge: number;
  quality: number;
  /** Below this the image is almost certainly unusable downstream. */
  minEdge: number;
}

const PROFILES: Record<ImagePurpose, PurposeProfile> = {
  // Faces: the descriptor model works from a small crop, so 1280 px is ample
  // and keeps enrolment (3–5 photos) under a megabyte in total.
  face: { maxEdge: 1280, quality: 0.86, minEdge: 320 },
  // Dashboards: OCR is the limiting factor, so we keep more pixels and a
  // higher quality — compression artefacts around seven-segment digits are
  // exactly what makes a "6" read as an "8".
  dashboard: { maxEdge: 1920, quality: 0.92, minEdge: 640 },
};

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export function validateImageFile(file: File | Blob): void {
  const type = file.type;
  if (!ACCEPTED_TYPES.includes(type as (typeof ACCEPTED_TYPES)[number])) {
    throw new AppError(`Unsupported image type: ${type}`, {
      kind: 'VALIDATION',
      messageKey: 'validation.fileType',
      retryable: false,
    });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new AppError(`Image too large: ${file.size} bytes`, {
      kind: 'VALIDATION',
      messageKey: 'validation.fileSize',
      messageParams: { size: '8 MB' },
      retryable: false,
    });
  }
}

async function decode(
  source: Blob,
): Promise<{ bitmap: ImageBitmap | HTMLImageElement; width: number; height: number }> {
  // createImageBitmap is both faster and lower-memory, but Safari < 15 and some
  // Android WebViews lack it, so fall back to an <img>.
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(source);
    return { bitmap, width: bitmap.width, height: bitmap.height };
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(source);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ bitmap: image, width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(
        new AppError('Image could not be decoded', {
          kind: 'VALIDATION',
          messageKey: 'validation.fileType',
        }),
      );
    };
    image.src = url;
  });
}

/** Reads dimensions through the same Safari-compatible decoder as the image
 * pipeline without retaining the decoded bitmap. */
export async function imageDimensions(source: Blob): Promise<{ width: number; height: number }> {
  const decoded = await decode(source);
  if ('close' in decoded.bitmap && typeof decoded.bitmap.close === 'function')
    decoded.bitmap.close();
  return { width: decoded.width, height: decoded.height };
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new AppError('Canvas encoding failed', { kind: 'UNKNOWN' }));
      },
      'image/jpeg',
      quality,
    );
  });
}

/**
 * FNV-1a over a downsampled grayscale grid.
 *
 * Deliberately *not* a cryptographic hash of the bytes: two JPEG encodings of
 * the same photograph differ byte-for-byte, but we want them to collide, since
 * the question being answered is "has this manager submitted this same
 * photograph before?".
 */
export function perceptualHash(imageData: ImageData): string {
  const { data, width, height } = imageData;
  const gridSize = 16;
  const cells = new Array<number>(gridSize * gridSize).fill(0);
  const counts = new Array<number>(gridSize * gridSize).fill(0);

  for (let y = 0; y < height; y += 1) {
    const row = Math.min(gridSize - 1, Math.floor((y / height) * gridSize));
    for (let x = 0; x < width; x += 1) {
      const col = Math.min(gridSize - 1, Math.floor((x / width) * gridSize));
      const index = (y * width + x) * 4;
      const luma =
        0.299 * (data[index] as number) +
        0.587 * (data[index + 1] as number) +
        0.114 * (data[index + 2] as number);
      const cell = row * gridSize + col;
      cells[cell] = (cells[cell] as number) + luma;
      counts[cell] = (counts[cell] as number) + 1;
    }
  }

  const averages = cells.map((sum, i) => sum / Math.max(1, counts[i] as number));
  const mean = averages.reduce((a, b) => a + b, 0) / averages.length;

  // One bit per cell: brighter or darker than the image's mean.
  let hash = 0x811c9dc5;
  for (const value of averages) {
    const bit = value >= mean ? 1 : 0;
    hash ^= bit;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  const bits = averages.map((v) => (v >= mean ? '1' : '0')).join('');
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    hex += Number.parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

/**
 * Downscales, re-encodes and hashes an image, stripping all metadata.
 */
export async function prepareImage(source: Blob, purpose: ImagePurpose): Promise<PreparedImage> {
  validateImageFile(source);
  const profile = PROFILES[purpose];
  const { bitmap, width, height } = await decode(source);

  const longestEdge = Math.max(width, height);
  if (longestEdge < profile.minEdge) {
    logger.warn('Image below recommended resolution', { purpose, width, height });
  }

  const scale = longestEdge > profile.maxEdge ? profile.maxEdge / longestEdge : 1;
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new AppError('2D canvas unavailable', { kind: 'UNKNOWN', messageKey: 'errors.unknown' });
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap as CanvasImageSource, 0, 0, targetWidth, targetHeight);

  if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();

  const hash = perceptualHash(context.getImageData(0, 0, targetWidth, targetHeight));
  const blob = await canvasToBlob(canvas, profile.quality);

  logger.debug('Image prepared', {
    purpose,
    from: `${width}x${height}`,
    to: `${targetWidth}x${targetHeight}`,
    bytesBefore: source.size,
    bytesAfter: blob.size,
  });

  return {
    blob,
    width: targetWidth,
    height: targetHeight,
    byteSize: blob.size,
    contentType: 'image/jpeg',
    hash,
    previewUrl: URL.createObjectURL(blob),
  };
}

// ---------------------------------------------------------------------------
// Pre-processing for OCR
// ---------------------------------------------------------------------------

export interface PreprocessOptions {
  grayscale?: boolean;
  /** Stretch the useful luminance range to black and white. This is especially
   * useful for a backlit LCD photographed through a dusty cover. */
  autoContrast?: boolean;
  /** 1 = unchanged; 1.4–1.8 helps a washed-out cluster in daylight. */
  contrast?: number;
  /** Convert the prepared image to black and white after contrast adjustment. */
  threshold?: number;
  sharpen?: boolean;
  /** Fractional crop applied before anything else, e.g. the framing overlay. */
  crop?: { x: number; y: number; width: number; height: number };
  rotateDegrees?: number;
  /** Upscale a small dashboard display before OCR. Tesseract benefits from
   * characters that are at least a few dozen pixels tall. */
  scale?: number;
}

/**
 * Applies the cheap, well-understood corrections that genuinely improve OCR on
 * an instrument cluster: crop to the framed region, desaturate, stretch
 * contrast, then a mild unsharp mask.
 *
 * Perspective correction is deliberately *not* attempted here — doing it badly
 * is worse than not doing it, and the framing overlay in the capture UI solves
 * most of the problem by asking the manager to square up.
 */
export async function preprocessForOcr(
  source: Blob,
  options: PreprocessOptions = {},
): Promise<Blob> {
  const { bitmap, width, height } = await decode(source);
  const crop = options.crop ?? { x: 0, y: 0, width: 1, height: 1 };

  const sx = Math.round(crop.x * width);
  const sy = Math.round(crop.y * height);
  const sw = Math.max(1, Math.round(crop.width * width));
  const sh = Math.max(1, Math.round(crop.height * height));
  const scale = Math.max(1, Math.min(3, options.scale ?? 1));

  const canvas = document.createElement('canvas');
  const rotated = Math.abs((options.rotateDegrees ?? 0) % 180) === 90;
  canvas.width = Math.round((rotated ? sh : sw) * scale);
  canvas.height = Math.round((rotated ? sw : sh) * scale);

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new AppError('2D canvas unavailable', { kind: 'UNKNOWN' });

  if (options.rotateDegrees) {
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((options.rotateDegrees * Math.PI) / 180);
    context.translate((-sw * scale) / 2, (-sh * scale) / 2);
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap as CanvasImageSource, sx, sy, sw, sh, 0, 0, sw * scale, sh * scale);
  if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;
  const contrast = options.contrast ?? 1;
  const intercept = 128 * (1 - contrast);
  let low = 0;
  let high = 255;

  if (options.autoContrast) {
    const histogram = new Uint32Array(256);
    for (let i = 0; i < data.length; i += 4) {
      const luma = Math.round(
        0.299 * (data[i] as number) +
          0.587 * (data[i + 1] as number) +
          0.114 * (data[i + 2] as number),
      );
      histogram[luma] = (histogram[luma] ?? 0) + 1;
    }
    const pixelCount = data.length / 4;
    const cutoff = pixelCount * 0.02;
    let seen = 0;
    for (let value = 0; value < 256; value += 1) {
      seen += histogram[value] ?? 0;
      if (seen >= cutoff) {
        low = value;
        break;
      }
    }
    seen = 0;
    for (let value = 255; value >= 0; value -= 1) {
      seen += histogram[value] ?? 0;
      if (seen >= cutoff) {
        high = value;
        break;
      }
    }
  }

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] as number;
    let g = data[i + 1] as number;
    let b = data[i + 2] as number;

    if (options.grayscale !== false) {
      let luma = 0.299 * r + 0.587 * g + 0.114 * b;
      if (options.autoContrast && high > low) {
        luma = ((luma - low) * 255) / (high - low);
      }
      r = g = b = luma;
    }
    if (contrast !== 1) {
      r = r * contrast + intercept;
      g = g * contrast + intercept;
      b = b * contrast + intercept;
    }
    data[i] = Math.max(0, Math.min(255, r));
    data[i + 1] = Math.max(0, Math.min(255, g));
    data[i + 2] = Math.max(0, Math.min(255, b));
  }

  context.putImageData(imageData, 0, 0);

  if (options.sharpen) {
    applyConvolution(context, canvas.width, canvas.height, [0, -1, 0, -1, 5, -1, 0, -1, 0]);
  }

  if (options.threshold != null) {
    const thresholded = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < thresholded.data.length; i += 4) {
      const value = (thresholded.data[i] as number) >= options.threshold ? 255 : 0;
      thresholded.data[i] = value;
      thresholded.data[i + 1] = value;
      thresholded.data[i + 2] = value;
    }
    context.putImageData(thresholded, 0, 0);
  }

  return canvasToBlob(canvas, 0.95);
}

function applyConvolution(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  kernel: readonly number[],
): void {
  const source = context.getImageData(0, 0, width, height);
  const output = context.createImageData(width, height);
  const side = Math.round(Math.sqrt(kernel.length));
  const half = Math.floor(side / 2);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let ky = 0; ky < side; ky += 1) {
        for (let kx = 0; kx < side; kx += 1) {
          const sy = Math.min(height - 1, Math.max(0, y + ky - half));
          const sx = Math.min(width - 1, Math.max(0, x + kx - half));
          const index = (sy * width + sx) * 4;
          const weight = kernel[ky * side + kx] as number;
          r += (source.data[index] as number) * weight;
          g += (source.data[index + 1] as number) * weight;
          b += (source.data[index + 2] as number) * weight;
        }
      }
      const target = (y * width + x) * 4;
      output.data[target] = Math.max(0, Math.min(255, r));
      output.data[target + 1] = Math.max(0, Math.min(255, g));
      output.data[target + 2] = Math.max(0, Math.min(255, b));
      output.data[target + 3] = source.data[target + 3] as number;
    }
  }

  context.putImageData(output, 0, 0);
}
