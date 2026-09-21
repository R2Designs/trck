import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import {
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  PenLine,
  Pencil,
  Route as RouteIcon,
  ScanFace,
  ShieldOff,
  Trash2,
} from 'lucide-react';
import { PageHeader, DetailList, DetailRow } from '@/components/common/PageHeader';
import { EntityCard } from '@/components/common/EntityCard';
import { Badge, EmploymentStatusBadge, TripStatusBadge } from '@/components/common/StatusBadge';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/controls';
import { SkeletonList } from '@/components/ui/skeleton';
import { EmptyState, ErrorState, NotFoundState } from '@/components/feedback/states';
import { useToast } from '@/components/ui/toast';
import { EMPTY_VALUE, formatDate, formatDateTime } from '@/lib/format';
import { toAppError } from '@/lib/errors';
import {
  addMonths,
  differenceInDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { cn } from '@/lib/cn';
import { useAuth } from '@/features/auth/session';
import { useEmployee, useFaceEnrolmentStatus, useSetEmployeeActive } from '@/features/fleet/api';
import { useAttendance } from '@/features/attendance/api';
import type { AttendanceWithRelations } from '@/features/attendance/api';
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
  const [attendanceMonth, setAttendanceMonth] = useState(() => startOfMonth(new Date()));

  const attendanceFrom = format(startOfMonth(attendanceMonth), 'yyyy-MM-dd');
  const attendanceTo = format(endOfMonth(attendanceMonth), 'yyyy-MM-dd');

  const employee = useEmployee(employeeId);
  const faces = useFaceEnrolmentStatus(employeeId);
  const attendance = useAttendance({
    employeeId,
    from: attendanceFrom,
    to: attendanceTo,
    limit: 100,
  });
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
        backTo="/fleet/drivers"
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

      {person.employee_type === 'DRIVER' && (
        <MonthlyAttendanceCalendar
          month={attendanceMonth}
          records={attendance.data ?? []}
          loading={attendance.isLoading}
          onPrevious={() => setAttendanceMonth((current) => subMonths(current, 1))}
          onNext={() => setAttendanceMonth((current) => addMonths(current, 1))}
        />
      )}

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">{t('employees.tabs.details')}</TabsTrigger>
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

function MonthlyAttendanceCalendar({
  month,
  records,
  loading,
  onPrevious,
  onNext,
}: {
  month: Date;
  records: AttendanceWithRelations[];
  loading: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }),
        end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
      }),
    [month],
  );
  const recordsByDate = useMemo(() => {
    const grouped = new Map<string, AttendanceWithRelations[]>();
    for (const record of records) {
      const day = grouped.get(record.attendance_date) ?? [];
      day.push(record);
      grouped.set(record.attendance_date, day);
    }
    return grouped;
  }, [records]);
  const weekdayNames = useMemo(() => {
    const monday = new Date(2026, 0, 5);
    const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    return Array.from({ length: 7 }, (_, index) =>
      formatter.format(new Date(2026, 0, monday.getDate() + index)),
    );
  }, [locale]);
  const monthLabel = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(month),
    [locale, month],
  );
  const faceDays = new Set(
    records
      .filter((record) => record.method === 'FACE_RECOGNITION')
      .map((record) => record.attendance_date),
  ).size;
  const manualDays = new Set(
    records
      .filter((record) => record.method !== 'FACE_RECOGNITION')
      .map((record) => record.attendance_date),
  ).size;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="gap-4 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CalendarCheck className="size-5 text-primary" aria-hidden />
            {t('attendance.history')}
          </CardTitle>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge tone="success" icon={ScanFace}>
              {t('attendance.methods.FACE_RECOGNITION')} · {faceDays}
            </Badge>
            <Badge tone="warning" icon={PenLine}>
              {t('attendance.methods.MANUAL_OVERRIDE')} · {manualDays}
            </Badge>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background p-1 sm:min-w-64">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('actions.back')}
            onClick={onPrevious}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <p className="min-w-0 text-center text-sm font-bold capitalize sm:text-base">
            {monthLabel}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('actions.next')}
            onClick={onNext}
          >
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-3 pt-3 sm:p-6 sm:pt-5">
        {loading ? (
          <div className="skeleton h-[22rem] w-full rounded-xl" />
        ) : (
          <div className="grid grid-cols-7 gap-1.5 sm:gap-2" role="grid" aria-label={monthLabel}>
            {weekdayNames.map((weekday) => (
              <div
                key={weekday}
                className="pb-1 text-center text-[0.65rem] font-bold uppercase tracking-wide text-muted-foreground sm:text-xs"
                role="columnheader"
              >
                {weekday}
              </div>
            ))}
            {days.map((day) => {
              const key = format(day, 'yyyy-MM-dd');
              const dayRecords = recordsByDate.get(key) ?? [];
              const hasFace = dayRecords.some((record) => record.method === 'FACE_RECOGNITION');
              const hasManual = dayRecords.some((record) => record.method !== 'FACE_RECOGNITION');
              const inMonth = isSameMonth(day, month);
              const labels = [
                hasFace ? t('attendance.methods.FACE_RECOGNITION') : null,
                hasManual ? t('attendance.methods.MANUAL_OVERRIDE') : null,
              ].filter(Boolean);

              return (
                <div
                  key={key}
                  role="gridcell"
                  aria-label={`${formatDate(day)}${labels.length > 0 ? ` · ${labels.join(', ')}` : ''}`}
                  className={cn(
                    'relative flex min-h-14 flex-col justify-between border-t border-border/60 p-1.5 sm:min-h-20 sm:p-3',
                    !inMonth && 'opacity-25',
                    inMonth && !hasFace && !hasManual && 'bg-transparent',
                    inMonth && hasFace && !hasManual && 'rounded-lg bg-success-muted/45',
                    inMonth && hasManual && !hasFace && 'rounded-lg bg-warning-muted/45',
                    inMonth && hasFace && hasManual && 'rounded-lg bg-muted/70',
                  )}
                >
                  <span
                    className={cn(
                      'grid size-6 place-items-center rounded-full text-xs font-semibold sm:text-sm',
                      !inMonth && 'text-muted-foreground',
                      isToday(day) && 'bg-primary text-primary-foreground',
                    )}
                  >
                    {format(day, 'd')}
                  </span>
                  {inMonth && (hasFace || hasManual) && (
                    <div className="flex items-center gap-1" aria-hidden>
                      {hasFace && (
                        <span className="flex size-5 items-center justify-center rounded-full bg-success text-success-foreground sm:size-7">
                          <ScanFace className="size-3 sm:size-4" />
                        </span>
                      )}
                      {hasManual && (
                        <span className="flex size-5 items-center justify-center rounded-full bg-warning text-warning-foreground sm:size-7">
                          <PenLine className="size-3 sm:size-4" />
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
