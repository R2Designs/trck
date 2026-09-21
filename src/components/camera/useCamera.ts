import { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from '@/lib/logger';
import { toAppError } from '@/lib/errors';
import type { AppError } from '@/lib/errors';

/**
 * Camera access.
 *
 * Every state a manager can actually land in is modelled explicitly, because
 * on Android in a depot yard they all happen: permission never asked,
 * granted, denied, permanently blocked, no camera at all, camera held by
 * another app, and the stream dying when the phone is locked mid-scan.
 *
 * Constraint choices worth knowing:
 *   • **Resolution is requested generously** (1920×1080 ideal). More pixels on
 *     the face means more tonal detail survives, which matters most for the
 *     under-exposed faces this product has to handle well.
 *   • **Exposure compensation is nudged up** where the browser exposes it.
 *     Phone auto-exposure meters for the whole frame, so a driver standing
 *     against a bright sky is systematically under-exposed; a positive bias
 *     partially corrects that at the source, which is always better than
 *     trying to recover it afterwards.
 *   • **Continuous focus**, because a manager holding a phone at arm's length
 *     next to a bus is never quite still.
 */

export type CameraStatus =
  'idle' | 'requesting' | 'streaming' | 'denied' | 'blocked' | 'unavailable' | 'in-use' | 'error';

export type CameraFacing = 'user' | 'environment';

interface ExtendedTrackCapabilities extends MediaTrackCapabilities {
  torch?: boolean;
  exposureMode?: string[];
  exposureCompensation?: { min: number; max: number; step: number };
  focusMode?: string[];
}

interface ExtendedTrackConstraints extends MediaTrackConstraintSet {
  torch?: boolean;
  exposureMode?: string;
  exposureCompensation?: number;
  focusMode?: string;
}

export interface UseCameraOptions {
  facing?: CameraFacing;
  /** Start the stream as soon as the component mounts. */
  autoStart?: boolean;
  /**
   * Bias the sensor towards a brighter exposure, in EV stops. Used on the
   * face-capture screens; left at 0 for dashboard photography, where a bright
   * bias would blow out a backlit instrument cluster.
   */
  exposureBias?: number;
}

export interface UseCameraResult {
  videoRef: React.RefObject<HTMLVideoElement>;
  status: CameraStatus;
  error: AppError | null;
  facing: CameraFacing;
  hasMultipleCameras: boolean;
  torchAvailable: boolean;
  torchOn: boolean;
  start: () => Promise<void>;
  stop: () => void;
  switchCamera: () => Promise<void>;
  toggleTorch: () => Promise<void>;
  /** Grabs the current frame as a full-resolution still. */
  capture: () => Promise<Blob | null>;
  /** Live dimensions of the stream, for coordinate mapping. */
  dimensions: { width: number; height: number };
}

function statusFromError(error: unknown): CameraStatus {
  if (!(error instanceof DOMException)) return 'error';
  switch (error.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'unavailable';
    case 'NotReadableError':
    case 'AbortError':
      return 'in-use';
    default:
      return 'error';
  }
}

export function useCamera(options: UseCameraOptions = {}): UseCameraResult {
  const { autoStart = true, exposureBias = 0 } = options;

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [error, setError] = useState<AppError | null>(null);
  const [facing, setFacing] = useState<CameraFacing>(options.facing ?? 'environment');
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setTorchOn(false);
    setStatus('idle');
  }, []);

  const applyAdvancedConstraints = useCallback(
    async (track: MediaStreamTrack) => {
      const capabilities = track.getCapabilities?.() as ExtendedTrackCapabilities | undefined;
      if (!capabilities) return;

      setTorchAvailable(Boolean(capabilities.torch));

      const advanced: ExtendedTrackConstraints[] = [];

      if (capabilities.focusMode?.includes('continuous')) {
        advanced.push({ focusMode: 'continuous' });
      }

      // Nudge exposure upward for face capture. The browser API is patchy, so
      // this is strictly best-effort — the CLAHE pass in `face-image.ts` is
      // what guarantees a usable face when the sensor will not cooperate.
      if (exposureBias !== 0 && capabilities.exposureCompensation) {
        const { min, max, step } = capabilities.exposureCompensation;
        const requested = Math.max(min, Math.min(max, exposureBias));
        const quantised = step > 0 ? Math.round(requested / step) * step : requested;
        if (capabilities.exposureMode?.includes('continuous')) {
          advanced.push({ exposureMode: 'continuous' });
        }
        advanced.push({ exposureCompensation: quantised });
      }

      if (advanced.length === 0) return;
      try {
        await track.applyConstraints({ advanced } as MediaTrackConstraints);
      } catch (caught) {
        // Applying an unsupported constraint must never kill a working stream.
        logger.debug('Advanced camera constraints rejected', { error: caught });
      }
    },
    [exposureBias],
  );

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('unavailable');
      setError(toAppError(new DOMException('No camera API', 'NotFoundError')));
      return;
    }

    setStatus('requesting');
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facing },
          // Generous but not absurd: 1080p is widely supported and gives the
          // face enough pixels without a multi-megabyte still.
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 24, max: 30 },
        },
        audio: false,
      });

      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      if (track) await applyAdvancedConstraints(track);

      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        await video.play().catch(() => undefined);
        setDimensions({ width: video.videoWidth, height: video.videoHeight });
      }

      // Only now do we know how many cameras exist: labels and deviceIds are
      // withheld until permission has been granted at least once.
      const devices = await navigator.mediaDevices.enumerateDevices();
      setHasMultipleCameras(devices.filter((device) => device.kind === 'videoinput').length > 1);

      setStatus('streaming');
    } catch (caught) {
      const nextStatus = statusFromError(caught);
      setStatus(nextStatus);
      setError(toAppError(caught));
      logger.warn('Camera could not start', { status: nextStatus, error: caught });
    }
  }, [applyAdvancedConstraints, facing]);

  const switchCamera = useCallback(async () => {
    stop();
    setFacing((current) => (current === 'user' ? 'environment' : 'user'));
  }, [stop]);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as ExtendedTrackConstraints],
      } as unknown as MediaTrackConstraints);
      setTorchOn(next);
    } catch (caught) {
      logger.debug('Torch not supported', { error: caught });
      setTorchAvailable(false);
    }
  }, [torchOn]);

  const capture = useCallback(async (): Promise<Blob | null> => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return null;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(video, 0, 0);

    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.94);
    });
  }, []);

  // Restart when the facing mode changes.
  useEffect(() => {
    if (!autoStart) return;
    void start();
    return stop;
    // `start` changes with `facing`, which is exactly when we want a restart.
  }, [autoStart, start, stop]);

  // A backgrounded tab has its camera revoked on most Android builds; make
  // that explicit instead of leaving a frozen frame on screen.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stop();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [stop]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onLoaded = () => setDimensions({ width: video.videoWidth, height: video.videoHeight });
    video.addEventListener('loadedmetadata', onLoaded);
    return () => video.removeEventListener('loadedmetadata', onLoaded);
  }, []);

  return {
    videoRef,
    status,
    error,
    facing,
    hasMultipleCameras,
    torchAvailable,
    torchOn,
    start,
    stop,
    switchCamera,
    toggleTorch,
    capture,
    dimensions,
  };
}
