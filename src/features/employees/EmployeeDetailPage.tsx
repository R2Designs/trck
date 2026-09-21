import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import {
  CalendarCheck,
  Pencil,
  Route as RouteIcon,
  ScanFace,
  ShieldOff,
  Trash2,
} from 'lucide-react';
import { PageHeader, DetailList, DetailRow } from '@/components/common/PageHeader';
import { EntityCard, initialsOf } from '@/components/common/EntityCard';
import { Badge, EmploymentStatusBadge, TripStatusBadge } from '@/components/common/StatusBadge';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/controls';
import { SkeletonList } from '@/components/ui/skeleton';
import { EmptyState, ErrorState, NotFoundState } from '@/components/feedback/states';
import { useToast } from '@/components/ui/toast';
import { EMPTY_VALUE, formatDate, formatDateTime, formatTime } from '@/lib/format';
import { toAppError } from '@/lib/errors';
import { differenceInDays } from 'date-fns';
import { useAuth } from '@/features/auth/session';
import { useEmployee, useFaceEnrolmentStatus, useSetEmployeeActive } from '@/features/fleet/api';
import { useAttendance } from '@/features/attendance/api';
import { useTrips } from '@/features/trips/api';
import { useDeleteBiometrics } from './enrolment';

/**
 * One driver.
 *
 * The face-enrolment card is the first thing under the header because it is
 * the thing that determines whether the rest of the product works for this
 * person, and it is invisible everywhere else.
 */
export default function EmployeeDetailPage() {
  const { t } = useTranslation();
  const { employeeId } = useParams<{ employeeId: string }>();
  const { can } = useAuth();
  const { toast } = useToast();

  const employee = useEmployee(employeeId);
  const faces = useFaceEnrolmentStatus(employeeId);
  const attendance = useAttendance({ employeeId, limit: 20 });
  const trips = useTrips({ driverId: employeeId, limit: 20 });
  const setActive = useSetEmployeeActive();
  const deleteBiometrics = useDeleteBiometrics();

  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [confirmDeleteFaces, setConfirmDeleteFaces] = useState(false);

  if (employee.isLoading) return <SkeletonList count={4} />;
  if (employee.isError)
    return <ErrorState error={employee.error} onRetry={() => void employee.refetch()} />;
  if (!employee.data) return <NotFoundState />;

  const person = employee.data;
  const enrolled = (faces.data?.embeddingCount ?? 0) > 0;
  const daysToExpiry = person.licence_expiry
    ? differenceInDays(new Date(person.licence_expiry), new Date())
    : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title={person.full_name}
        description={`${person.employee_code} · ${t(`employeeType.${person.employee_type}`)}`}
        action={
          can('employee.update') && (
            <Button asChild variant="outline" size="md">
              <Link to={`/fleet/drivers/${person.id}/edit`}>
                <Pencil className="size-4" aria-hidden />
                {t('actions.edit')}
              </Link>
            </Button>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <EmploymentStatusBadge status={person.employment_status} />
        {daysToExpiry != null && daysToExpiry < 0 && (
          <Badge tone="danger" size="sm">
            {t('employees.licenceExpired')}
          </Badge>
        )}
        {daysToExpiry != null && daysToExpiry >= 0 && daysToExpiry <= 30 && (
          <Badge tone="warning" size="sm">
            {t('employees.licenceExpiringSoon', { count: daysToExpiry })}
          </Badge>
        )}
      </div>

      {person.employee_type === 'DRIVER' && (
        <Card className={enrolled ? undefined : 'border-warning/50 bg-warning-muted/30'}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ScanFace className="size-4 text-muted-foreground" aria-hidden />
              {t('employees.faceEnrolment')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {faces.isLoading ? (
              <div className="skeleton h-5 w-40" />
            ) : (
              <p className="text-sm">
                {enrolled
                  ? t('employees.faceEnrolled', { count: faces.data?.embeddingCount ?? 0 })
                  : t('employees.faceNotEnrolled')}
              </p>
            )}
            {!enrolled && (
              <p className="text-sm text-muted-foreground">{t('employees.faceEnrolmentPrompt')}</p>
            )}

            <div className="flex flex-wrap gap-2">
              {can('employee.enrolFace') && (
                <Button asChild size="md" variant={enrolled ? 'outline' : 'primary'}>
                  <Link to={`/fleet/drivers/${person.id}/faces`}>
                    <ScanFace className="size-4" aria-hidden />
                    {enrolled ? t('actions.add') : t('face.enrolTitle')}
                  </Link>
                </Button>
              )}
              {enrolled && can('employee.deleteBiometrics') && (
                <Button size="md" variant="ghost" onClick={() => setConfirmDeleteFaces(true)}>
                  <Trash2 className="size-4" aria-hidden />
                  {t('actions.delete')}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">{t('employees.tabs.details')}</TabsTrigger>
          <TabsTrigger value="attendance">{t('employees.tabs.attendance')}</TabsTrigger>
          <TabsTrigger value="trips">{t('employees.tabs.trips')}</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="space-y-4">
          <Card>
            <CardContent className="pt-4">
              <DetailList>
                <DetailRow label={t('employees.phone')} value={person.phone ?? EMPTY_VALUE} />
                <DetailRow
                  label={t('employees.joiningDate')}
                  value={person.joining_date ? formatDate(person.joining_date) : EMPTY_VALUE}
                />
                <DetailRow
                  label={t('employees.licenceNumber')}
                  value={person.licence_number ?? EMPTY_VALUE}
                  mono
                />
                <DetailRow
                  label={t('employees.licenceExpiry')}
                  value={person.licence_expiry ? formatDate(person.licence_expiry) : EMPTY_VALUE}
                />
                <DetailRow
                  label={t('employees.emergencyContactName')}
                  value={person.emergency_contact_name ?? EMPTY_VALUE}
                />
                <DetailRow
                  label={t('employees.emergencyContactPhone')}
                  value={person.emergency_contact_phone ?? EMPTY_VALUE}
                />
                {person.notes && <DetailRow label={t('employees.notes')} value={person.notes} />}
              </DetailList>
            </CardContent>
          </Card>

          {can('employee.deactivate') && (
            <Card>
              <CardContent className="pt-4">
                <Button
                  variant={person.employment_status === 'ACTIVE' ? 'outline' : 'primary'}
                  size="lg"
                  block
                  onClick={() => setConfirmDeactivate(true)}
                >
                  <ShieldOff className="size-4" aria-hidden />
                  {person.employment_status === 'ACTIVE'
                    ? t('actions.deactivate')
                    : t('actions.reactivate')}
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="attendance" className="space-y-3">
          {attendance.isLoading && <SkeletonList count={3} />}
          {!attendance.isLoading && (attendance.data?.length ?? 0) === 0 && (
            <EmptyState
              icon={CalendarCheck}
              title={t('empty.attendance')}
              description={t('empty.attendanceBody')}
            />
          )}
          <ul className="space-y-3">
            {attendance.data?.map((record) => (
              <li key={record.id}>
                <EntityCard
                  avatarText={initialsOf(person.full_name)}
                  title={`${formatDate(record.attendance_date)} · ${formatTime(record.recorded_at)}`}
                  subtitle={[record.bus?.registration_number, record.route?.name]
                    .filter(Boolean)
                    .join(' · ')}
                  meta={
                    <Badge tone={record.manual_override ? 'warning' : 'success'} size="sm">
                      {t(`attendance.methods.${record.method}`)}
                    </Badge>
                  }
                />
              </li>
            ))}
          </ul>
        </TabsContent>

        <TabsContent value="trips" className="space-y-3">
          {trips.isLoading && <SkeletonList count={3} />}
          {!trips.isLoading && (trips.data?.length ?? 0) === 0 && (
            <EmptyState
              icon={RouteIcon}
              title={t('empty.trips')}
              description={t('empty.tripsBody')}
            />
          )}
          <ul className="space-y-3">
            {trips.data?.map((trip) => (
              <li key={trip.id}>
                <EntityCard
                  to={`/trips/${trip.id}`}
                  icon={RouteIcon}
                  title={trip.bus?.registration_number ?? ''}
                  subtitle={`${trip.route?.name ?? ''} · ${formatDateTime(trip.actual_start_time)}`}
                  meta={<TripStatusBadge status={trip.status} />}
                />
              </li>
            ))}
          </ul>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={confirmDeactivate}
        onOpenChange={setConfirmDeactivate}
        tone={person.employment_status === 'ACTIVE' ? 'destructive' : 'default'}
        title={t('employees.deactivateTitle', { name: person.full_name })}
        description={t('employees.deactivateBody')}
        loading={setActive.isPending}
        onConfirm={async () => {
          try {
            await setActive.mutateAsync({
              id: person.id,
              active: person.employment_status !== 'ACTIVE',
            });
            toast({
              tone: 'success',
              title: t(
                person.employment_status === 'ACTIVE'
                  ? 'employees.deactivated'
                  : 'employees.reactivated',
                { name: person.full_name },
              ),
            });
            setConfirmDeactivate(false);
            void employee.refetch();
          } catch (caught) {
            const appError = toAppError(caught);
            toast({ tone: 'error', title: t(appError.messageKey, appError.messageParams) });
          }
        }}
      />

      <ConfirmDialog
        open={confirmDeleteFaces}
        onOpenChange={setConfirmDeleteFaces}
        tone="destructive"
        title={t('face.deleteTitle', { name: person.full_name })}
        description={t('face.deleteBody')}
        requireReason
        reasonLabel={t('face.deleteReason')}
        minReasonLength={5}
        loading={deleteBiometrics.isPending}
        onConfirm={async (reason) => {
          try {
            await deleteBiometrics.mutateAsync({ employeeId: person.id, reason: reason ?? '' });
            toast({ tone: 'success', title: t('face.deleted', { name: person.full_name }) });
            setConfirmDeleteFaces(false);
          } catch (caught) {
            const appError = toAppError(caught);
            toast({ tone: 'error', title: t(appError.messageKey, appError.messageParams) });
          }
        }}
      />
    </div>
  );
}
