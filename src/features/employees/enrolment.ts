import { useMutation, useQueryClient } from '@tanstack/react-query';
import { assessFrameQuality } from '@domain/face-match.ts';
import type { QualityAssessment } from '@domain/face-match.ts';
import type { Thresholds } from '@domain/thresholds.ts';
import { supabase } from '@/lib/supabase/client';
import { getStorageProvider, buildFaceObjectKey } from '@/providers/storage';
import { getFaceProvider } from '@/providers/face';
import { prepareImage } from '@/lib/image';
import type { PreparedImage } from '@/lib/image';
import { measureFrameQuality } from '@/lib/face-image';
import { queryKeys } from '@/app/query-client';
import { useAuth } from '@/features/auth/session';
import { trackEvent } from '@/providers/analytics';
import { logger } from '@/lib/logger';

/**
 * Face enrolment.
 *
 * The enrolled photographs are the ceiling on how well recognition will ever
 * work for this driver, so the flow is deliberately fussy about them: quality
 * is assessed on the *still*, not on the preview frame, and an unusable photo
 * is refused with a reason rather than accepted and regretted later.
 *
 * Poses are captured across angles on purpose. A single straight-on template
 * matches a straight-on scan and little else, and a manager scanning someone
 * in a bus doorway rarely gets straight-on.
 */

export type EnrolmentPose = 'FRONT' | 'LEFT' | 'RIGHT' | 'NEUTRAL';

export const ENROLMENT_POSES: readonly EnrolmentPose[] = ['FRONT', 'LEFT', 'RIGHT', 'NEUTRAL'];

export interface EnrolmentShot {
  pose: EnrolmentPose;
  image: PreparedImage;
  assessment: QualityAssessment;
  descriptor: number[] | null;
}

/**
 * Assesses a captured still and describes it.
 *
 * Quality is measured on the full-resolution capture rather than the preview
 * because the preview is 4:3-cropped, downscaled and motion-blurred — judging
 * the still by the preview is how unusable photos get through.
 */
export async function evaluateEnrolmentShot(
  blob: Blob,
  thresholds: Thresholds,
): Promise<{ image: PreparedImage; assessment: QualityAssessment; descriptor: number[] | null }> {
  const image = await prepareImage(blob, 'face');
  const provider = getFaceProvider();
  await provider.load();

  const bitmap = await createImageBitmap(image.blob);
  try {
    const detection = await provider.detect({ source: bitmap, still: true, embed: true });
    const face = detection.faces[0];

    const signals = face
      ? measureFrameQuality(
          bitmap,
          bitmap.width,
          bitmap.height,
          face.box,
          detection.faces.length,
          face.detectionScore,
          { yawDegrees: face.yawDegrees, pitchDegrees: face.pitchDegrees },
        )
      : detection.quality;

    return {
      image,
      assessment: assessFrameQuality(signals, thresholds),
      descriptor: face?.descriptor ?? null,
    };
  } finally {
    bitmap.close();
  }
}

export interface SaveEnrolmentInput {
  employeeId: string;
  depotId: string;
  shots: readonly EnrolmentShot[];
  noticeVersion: string;
  photoRetentionDays: number;
}

/**
 * Persists an enrolment.
 *
 * Order matters and is chosen so a partial failure never leaves an embedding
 * without the consent that authorises it:
 *   consent → photo upload → photo row → embedding row.
 */
export function useSaveEnrolment() {
  const queryClient = useQueryClient();
  const { identity } = useAuth();

  return useMutation({
    mutationKey: ['enrolment.save'],
    mutationFn: async (input: SaveEnrolmentInput) => {
      if (!identity) throw new Error('Not authenticated');

      const usable = input.shots.filter((shot) => shot.assessment.acceptable && shot.descriptor);
      if (usable.length === 0) throw new Error('No usable enrolment photos');

      const provider = getFaceProvider();
      const storage = getStorageProvider();

      // The database deliberately keeps revoked consent records for audit, so
      // its uniqueness rule is a partial index (`where revoked_at is null`).
      // PostgREST cannot target that index with `upsert(onConflict)`. Resolve
      // the active record explicitly instead: update it when re-enrolling, or
      // insert the first consent for this employee.
      const activeConsent = await supabase
        .from('biometric_consents')
        .select('id')
        .eq('employee_id', input.employeeId)
        .is('revoked_at', null)
        .maybeSingle();
      if (activeConsent.error) throw activeConsent.error;

      const consentPayload = {
        organization_id: identity.organizationId,
        employee_id: input.employeeId,
        notice_version: input.noticeVersion,
        acknowledged_by: identity.user.id,
        acknowledged_at: new Date().toISOString(),
        photo_retention_days: input.photoRetentionDays,
      };
      const consent = activeConsent.data
        ? await supabase
            .from('biometric_consents')
            .update(consentPayload)
            .eq('id', activeConsent.data.id)
        : await supabase.from('biometric_consents').insert(consentPayload);
      if (consent.error) throw consent.error;

      for (const shot of usable) {
        const fileId = crypto.randomUUID();
        const path = buildFaceObjectKey({
          organizationId: identity.organizationId,
          employeeId: input.employeeId,
          fileId,
        });

        const uploaded = await storage.upload({
          bucket: 'faces',
          path,
          body: shot.image.blob,
          contentType: 'image/jpeg',
        });

        const photo = await supabase
          .from('employee_photos')
          .insert({
            organization_id: identity.organizationId,
            depot_id: input.depotId,
            employee_id: input.employeeId,
            storage_provider: uploaded.provider,
            storage_bucket: uploaded.bucket,
            storage_path: uploaded.path,
            content_type: 'image/jpeg',
            byte_size: shot.image.byteSize,
            width: shot.image.width,
            height: shot.image.height,
            quality_score: shot.assessment.score,
            pose_hint: shot.pose,
            captured_by: identity.user.id,
          })
          .select('id')
          .single();
        if (photo.error) throw photo.error;

        const embedding = await supabase.from('face_embeddings').insert({
          organization_id: identity.organizationId,
          depot_id: input.depotId,
          employee_id: input.employeeId,
          photo_id: photo.data.id,
          provider: provider.name,
          model_version: provider.modelVersion,
          dimensions: (shot.descriptor as number[]).length,
          embedding: shot.descriptor as number[],
          quality_score: shot.assessment.score,
          created_by: identity.user.id,
        });
        if (embedding.error) throw embedding.error;
      }

      trackEvent('employee_face_enrolled', {
        photo_count: input.shots.length,
        usable_count: usable.length,
        mean_quality:
          Math.round(
            (usable.reduce((sum, shot) => sum + shot.assessment.score, 0) / usable.length) * 100,
          ) / 100,
      });

      return { saved: usable.length };
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.employeeFaceStatus(variables.employeeId),
      });
    },
  });
}

/**
 * Deletes every face photograph and template for one driver.
 *
 * Runs through an RPC so the storage objects, the embedding soft-delete, the
 * consent revocation and the audit entry all happen together. Attendance
 * already recorded is untouched — the record of who was present stays, the
 * biometric material behind it does not.
 */
export function useDeleteBiometrics() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['enrolment.delete'],
    mutationFn: async ({ employeeId, reason }: { employeeId: string; reason: string }) => {
      const { data, error } = await supabase.rpc('rpc_delete_biometric_data', {
        p_employee_id: employeeId,
        p_reason: reason,
      });
      if (error) throw error;
      logger.info('Biometric data deleted', { employeeId });
      return data;
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.employeeFaceStatus(variables.employeeId),
      });
    },
  });
}
