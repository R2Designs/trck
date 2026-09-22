import { useEffect, useMemo, useState } from 'react';
import type { EmployeePhotoRow } from '@/lib/supabase/database.types';
import { getStorageProvider } from '@/providers/storage';

export type FacePhotoSummary = Pick<
  EmployeePhotoRow,
  'id' | 'storage_path' | 'pose_hint' | 'created_at' | 'quality_score'
>;

/** Resolves private enrolment photos to short-lived URLs for display only. */
export function useFacePhotoUrls(photos: readonly FacePhotoSummary[]) {
  const paths = useMemo(() => photos.map((photo) => photo.storage_path), [photos]);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (paths.length === 0) {
      setUrls(new Map());
      return;
    }

    let cancelled = false;
    void getStorageProvider()
      .getSignedUrls('faces', paths, 300)
      .then((signed) => {
        if (!cancelled) {
          setUrls(new Map([...signed].map(([path, value]) => [path, value.url])));
        }
      })
      .catch(() => {
        if (!cancelled) setUrls(new Map());
      });

    return () => {
      cancelled = true;
    };
  }, [paths]);

  return urls;
}
