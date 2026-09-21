import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, ScanFace } from 'lucide-react';
import { assessFrameQuality, matchFace } from '@domain/face-match.ts';
import type { EnrolledDescriptor, MatchResult, QualityAssessment } from '@domain/face-match.ts';
import type { Thresholds } from '@domain/thresholds.ts';
import type { LivenessResult } from '@domain/types.ts';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/controls';
import { getFaceProvider } from '@/providers/face';
import { logger } from '@/lib/logger';
import { useCamera } from './useCamera';
import { CameraView, FaceGuideOverlay } from './CameraView';

/**
 * Live face scanner.
 *
 * How a scan actually runs:
 *
 *   1. The model loads (lazily — this is the only place, besides enrolment,
 *      that pays for it).
 *   2. A light loop runs at ~4 fps with `embed: false`, purely to drive the
 *      on-screen guidance: is there one face, is it big enough, is there
 *      enough tonal detail in it.
 *   3. Once several consecutive frames are acceptable, one frame is described
 *      properly — from an illumination-normalised crop — and matched against
 *      the candidate set.
 *
 * The loop is deliberately slow. 4 fps is plenty for guidance, and running
 * detection flat out on a low-end Android phone heats it, drains it, and makes
 * the preview stutter, which makes framing *harder*.
 */

export type ScanOutcome =
  | {
      kind: 'MATCH';
      match: MatchResult;
      liveness: LivenessResult;
      livenessScore: number | null;
      durationMs: number;
    }
  | { kind: 'LOW_CONFIDENCE'; match: MatchResult; durationMs: number }
  | { kind: 'NO_FACE' }
  | { kind: 'MULTIPLE_FACES' }
  | { kind: 'LIVENESS_FAILED' }
  | { kind: 'NO_CANDIDATES' }
  | { kind: 'QUALITY'; assessment: QualityAssessment };

const FRAME_INTERVAL_MS = 250;
/** Consecutive good frames before we commit to describing one. */
const STABLE_FRAMES_REQUIRED = 3;
const SCAN_TIMEOUT_MS = 20_000;

export function FaceScanner({
  candidates,
  thresholds,
  onResult,
  onFallback,
  fallbackLabel,
  facing = 'environment',
}: {
  candidates: readonly EnrolledDescriptor[];
  thresholds: Thresholds;
  onResult: (outcome: ScanOutcome) => void;
  onFallback: () => void;
  fallbackLabel: string;
  facing?: 'user' | 'environment';
}) {
  const { t } = useTranslation();
  // A positive exposure bias: the common failure is a driver backlit by the
  // sky, and correcting at the sensor beats recovering in software.
  const camera = useCamera({ facing, exposureBias: 0.7 });
  const provider = getFaceProvider();

  const [modelProgress, setModelProgress] = useState(0);
  const [modelReady, setModelReady] = useState(provider.isLoaded());
  const [scanning, setScanning] = useState(false);
  const [assessment, setAssessment] = useState<QualityAssessment | null>(null);

  const stableFrames = useRef(0);
  const startedAt = useRef(0);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    let active = true;

    void provider
      .load((fraction) => active && setModelProgress(fraction))
      .then(() => active && setModelReady(true))
      .catch((error) => {
        logger.error('Face model load failed in scanner', { error });
        if (active) onFallback();
      });

    return () => {
      active = false;
      cancelled.current = true;
      // Free the WASM/GPU memory as soon as we leave: on a 2 GB phone, holding
      // it while browsing the rest of the app is what makes the tab get killed.
      void provider.dispose();
    };
  }, [onFallback, provider]);

  const finish = useCallback(
    (outcome: ScanOutcome) => {
      cancelled.current = true;
      setScanning(false);
      onResult(outcome);
    },
    [onResult],
  );

  const runScan = useCallback(async () => {
    if (!modelReady || camera.status !== 'streaming') return;

    if (candidates.length === 0) {
      finish({ kind: 'NO_CANDIDATES' });
      return;
    }

    cancelled.current = false;
    stableFrames.current = 0;
    startedAt.current = performance.now();
    setScanning(true);

    while (!cancelled.current) {
      const elapsed = performance.now() - startedAt.current;
      if (elapsed > SCAN_TIMEOUT_MS) {
        finish({ kind: 'NO_FACE' });
        return;
      }

      const video = camera.videoRef.current;
      if (!video || video.readyState < 2) {
        await delay(FRAME_INTERVAL_MS);
        continue;
      }

      try {
        // Guidance pass: cheap, no descriptor.
        const preview = await provider.detect({ source: video, embed: false });
        const quality = assessFrameQuality(preview.quality, thresholds);
        setAssessment(quality);

        if (preview.faces.length > 1) {
          finish({ kind: 'MULTIPLE_FACES' });
          return;
        }

        if (!quality.acceptable) {
          stableFrames.current = 0;
          await delay(FRAME_INTERVAL_MS);
          continue;
        }

        stableFrames.current += 1;
        if (stableFrames.current < STABLE_FRAMES_REQUIRED) {
          await delay(FRAME_INTERVAL_MS);
          continue;
        }

        // Commit: describe this frame properly and match it.
        const detection = await provider.detect({ source: video, embed: true });
        const face = detection.faces[0];
        if (!face?.descriptor) {
          stableFrames.current = 0;
          await delay(FRAME_INTERVAL_MS);
          continue;
        }

        const livenessScore = face.livenessScore;
        const liveness: LivenessResult = !provider.supportsLiveness
          ? 'UNSUPPORTED'
          : livenessScore == null
            ? 'SKIPPED'
            : livenessScore >= 0.5
              ? 'PASSED'
              : 'FAILED';

        if (thresholds.faceRequireLiveness && liveness === 'FAILED') {
          finish({ kind: 'LIVENESS_FAILED' });
          return;
        }

        const match = matchFace(face.descriptor, candidates, thresholds, provider.modelVersion);
        const durationMs = Math.round(performance.now() - startedAt.current);

        if (match.decision === 'NOT_VERIFIED') {
          finish({ kind: 'LOW_CONFIDENCE', match, durationMs });
          return;
        }

        finish({ kind: 'MATCH', match, liveness, livenessScore, durationMs });
        return;
      } catch (error) {
        logger.warn('Scan frame failed', { error });
        await delay(FRAME_INTERVAL_MS * 2);
      }
    }
  }, [camera, candidates, finish, modelReady, provider, thresholds]);

  const hint = (() => {
    if (!scanning) return t('attendance.scanInstruction');
    if (!assessment) return t('attendance.scanning');
    if (assessment.issues.includes('NO_FACE')) return t('attendance.scanInstruction');
    if (assessment.issues.includes('FACE_TOO_SMALL')) return t('face.quality.FACE_TOO_SMALL');
    if (assessment.issues.includes('TOO_BLURRY')) return t('face.quality.TOO_BLURRY');
    if (assessment.issues.includes('LOW_FACE_DETAIL')) return t('face.quality.LOW_FACE_DETAIL');
    if (assessment.warnings.includes('BACKLIT')) return t('face.quality.BACKLIT');
    if (assessment.warnings.includes('TOO_DARK')) return t('face.quality.TOO_DARK');
    return t('attendance.scanHoldStill');
  })();

  const tone = !assessment ? 'neutral' : assessment.acceptable ? 'good' : 'warning';

  return (
    <div className="space-y-4">
      {!modelReady && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t('face.modelLoading')}
          </div>
          <Progress className="mt-3" value={Math.round(modelProgress * 100)} />
        </div>
      )}

      <CameraView
        camera={camera}
        mirrored={camera.facing === 'user'}
        onFallback={onFallback}
        fallbackLabel={fallbackLabel}
        overlay={<FaceGuideOverlay tone={tone} hint={hint} />}
      />

      <div className="space-y-2">
        <Button
          size="lg"
          block
          onClick={() => void runScan()}
          disabled={!modelReady || camera.status !== 'streaming'}
          loading={scanning}
          loadingLabel={t('attendance.scanning')}
        >
          <ScanFace className="size-5" aria-hidden />
          {t('attendance.scanDriverFace')}
        </Button>
        <Button variant="ghost" size="lg" block onClick={onFallback}>
          {fallbackLabel}
        </Button>
      </div>
    </div>
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
