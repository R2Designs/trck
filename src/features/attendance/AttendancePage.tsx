import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { CalendarCheck, ScanFace, UserCheck } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { EntityCard, initialsOf } from '@/components/common/EntityCard';
import { Badge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FilterSheet } from '@/components/common/FilterSheet';
import { SkeletonList } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { formatDate, formatTime } from '@/lib/format';
import { useActiveDepot, useAuth } from '@/features/auth/session';
import { useAttendance } from './api';

/**
 * Attendance history.
 *
 * Manual entries are visually distinct, not hidden: a depot where half of
 * attendance is recorded by hand is telling you something about the scanner,
 * and that should be obvious from the list rather than buried in a report.
 */
export default function AttendancePage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const depot = useActiveDepot();

  const [range, setRange] = useState<'today' | '7' | '30'>('today');
  const [manualOnly, setManualOnly] = useState(false);

  const today = new Date();
  const from =
    range === 'today'
      ? today.toISOString().slice(0, 10)
      : new Date(today.getTime() - (range === '7' ? 7 : 30) * 86_400_000)
          .toISOString()
          .slice(0, 10);

  const { data, isLoading, isError, error, refetch } = useAttendance({
    depotId: depot?.id ?? null,
    from,
    manualOnly,
  });

  const activeFilters = (range !== 'today' ? 1 : 0) + (manualOnly ? 1 : 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('attendance.title')}
        description={depot?.name}
        action={
          can('attendance.record') && (
            <Button asChild size="md">
              <Link to="/attendance/take">
                <ScanFace className="size-4" aria-hidden />
                {t('home.takeAttendance')}
              </Link>
            </Button>
          )
        }
      />

      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {range === 'today'
            ? t('common.today')
            : t(range === '7' ? 'common.last7Days' : 'common.last30Days')}
        </p>
        <FilterSheet
          activeCount={activeFilters}
          onClear={() => {
            setRange('today');
            setManualOnly(false);
          }}
        >
          <Field label={t('reports.filters.dateRange')}>
            {(fieldProps) => (
              <Select value={range} onValueChange={(value) => setRange(value as typeof range)}>
                <SelectTrigger id={fieldProps.id}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">{t('common.today')}</SelectItem>
                  <SelectItem value="7">{t('common.last7Days')}</SelectItem>
                  <SelectItem value="30">{t('common.last30Days')}</SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>

          <Field label={t('attendance.methods.MANUAL_OVERRIDE')}>
            {(fieldProps) => (
              <Select
                value={manualOnly ? 'yes' : 'no'}
                onValueChange={(value) => setManualOnly(value === 'yes')}
              >
                <SelectTrigger id={fieldProps.id}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="no">{t('common.all')}</SelectItem>
                  <SelectItem value="yes">
                    {t('home.attendanceManual', { count: 0 }).replace('0 ', '')}
                  </SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>
        </FilterSheet>
      </div>

      {isLoading && <SkeletonList count={5} />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}

      {!isLoading && !isError && (data?.length ?? 0) === 0 && (
        <EmptyState
          icon={CalendarCheck}
          title={t('empty.attendance')}
          description={t('empty.attendanceBody')}
          action={
            can('attendance.record') && (
              <Button asChild>
                <Link to="/attendance/take">{t('home.takeAttendance')}</Link>
              </Button>
            )
          }
        />
      )}

      <ul className="space-y-3">
        {data?.map((record) => (
          <li key={record.id}>
            <EntityCard
              to={record.employee ? `/fleet/drivers/${record.employee.id}` : undefined}
              avatarText={initialsOf(record.employee?.full_name ?? '?')}
              title={record.employee?.full_name ?? t('common.unknown')}
              subtitle={[
                record.employee?.employee_code,
                record.bus?.registration_number,
                record.route?.name,
              ]
                .filter(Boolean)
                .join(' · ')}
              meta={
                <>
                  <Badge
                    tone={record.manual_override ? 'warning' : 'success'}
                    icon={record.manual_override ? UserCheck : ScanFace}
                    size="sm"
                  >
                    {t(`attendance.methods.${record.method}`)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {range === 'today'
                      ? formatTime(record.recorded_at)
                      : `${formatDate(record.attendance_date)} · ${formatTime(record.recorded_at)}`}
                  </span>
                </>
              }
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
