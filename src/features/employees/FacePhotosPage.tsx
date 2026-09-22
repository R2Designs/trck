import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { Camera, Images, ScanFace } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, NotFoundState } from '@/components/feedback/states';
import { SkeletonList } from '@/components/ui/skeleton';
import { useAuth } from '@/features/auth/session';
import { useEmployee, useFaceEnrolmentStatus } from '@/features/fleet/api';
import { useFacePhotoUrls } from './face-photo-urls';

export default function FacePhotosPage() {
  const { t } = useTranslation();
  const { employeeId } = useParams<{ employeeId: string }>();
  const { can } = useAuth();
  const employee = useEmployee(employeeId);
  const faces = useFaceEnrolmentStatus(employeeId);
  const photos = useMemo(() => faces.data?.photos ?? [], [faces.data?.photos]);
  const urls = useFacePhotoUrls(photos);

  if (employee.isLoading || faces.isLoading) return <SkeletonList count={4} />;
  if (employee.isError)
    return <ErrorState error={employee.error} onRetry={() => void employee.refetch()} />;
  if (faces.isError)
    return <ErrorState error={faces.error} onRetry={() => void faces.refetch()} />;
  if (!employee.data) return <NotFoundState />;

  const person = employee.data;

  return (
    <div className="space-y-6">
      <PageHeader
        backTo={`/fleet/drivers/${person.id}`}
        title={t('employees.faceEnrolment')}
        description={person.full_name}
        action={
          can('employee.enrolFace') && (
            <Button asChild size="md">
              <Link to={`/fleet/drivers/${person.id}/faces`}>
                <Camera className="size-4" aria-hidden />
                {t('employees.retakePhotos')}
              </Link>
            </Button>
          )
        }
      />

      {photos.length === 0 ? (
        <EmptyState
          icon={ScanFace}
          title={t('employees.faceNotEnrolled')}
          description={t('employees.faceEnrolmentPrompt')}
          action={
            can('employee.enrolFace') ? (
              <Button asChild>
                <Link to={`/fleet/drivers/${person.id}/faces`}>{t('face.enrolTitle')}</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <section aria-label={t('employees.faceEnrolment')}>
          <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Images className="size-4" aria-hidden />
            {t('employees.savedPhotos', { count: photos.length })}
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
            {photos.map((photo) => {
              const url = urls.get(photo.storage_path);
              return (
                <figure
                  key={photo.id}
                  className="overflow-hidden rounded-2xl bg-muted shadow-sm ring-1 ring-border"
                >
                  {url ? (
                    <img
                      src={url}
                      alt={`${person.full_name} · ${photo.pose_hint ?? t('employees.faceEnrolment')}`}
                      className="aspect-[4/5] w-full object-cover"
                    />
                  ) : (
                    <div className="skeleton aspect-[4/5] w-full" />
                  )}
                </figure>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
