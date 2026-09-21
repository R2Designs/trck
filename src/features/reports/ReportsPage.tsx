import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, FileSpreadsheet } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SegmentedControl } from '@/components/ui/controls';
import { SkeletonList } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/feedback/states';
import { useToast } from '@/components/ui/toast';
import { downloadCsv, exportFilename, toCsv } from '@/lib/csv';
import type { CsvColumn } from '@/lib/csv';
import { formatDate, formatDateTime } from '@/lib/format';
import { trackEvent } from '@/providers/analytics';
import { useActiveDepot, useAuth } from '@/features/auth/session';
import { useDepots } from '@/features/fleet/api';
import { useAttendance } from '@/features/attendance/api';
import type { AttendanceWithRelations } from '@/features/attendance/api';
import { useTrips } from '@/features/trips/api';
import type { TripWithRelations } from '@/features/trips/api';
import { useAnomalies } from '@/features/anomalies/api';
import type { AnomalyWithRelations } from '@/features/anomalies/api';
import { anomalyToExplainable, useAnomalyExplanation } from '@/features/anomalies/explain';

/**
 * Reports.
 *
 * Pick a report, pick a window, look at it, take it away.
 *
 * Two things are deliberate here. First, there is no "export everything"
 * permission: each report reuses the same query hook the corresponding screen
 * uses, so a manager's export is their depot's data and an administrator's is
 * the organisation's — RLS decides, exactly as it does everywhere else.
 *
 * Second, *headers* are translated but *values* are not. A registration number
 * and a driver's name mean the same thing in every language, and translating
 * them would break matching the file against anything else the operator keeps.
 * Enum values (status, severity, method) stay in their stored form for the same
 * reason — the preview table below is where a human reads them, and it shows
 * the same rows the CSV will contain.
 */

type ReportKind = 'attendance' | 'trips' | 'anomalies';
type Window = '7' | '30' | '90';

const PREVIEW_ROWS = 8;
const EXPORT_LIMIT = 1000;

export default function ReportsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const activeDepot = useActiveDepot();
  const explain = useAnomalyExplanation();

  const [report, setReport] = useState<ReportKind>('attendance');
  const [days, setDays] = useState<Window>('30');
  const [depotId, setDepotId] = useState<string>(activeDepot?.id ?? 'ALL');

  const depots = useDepots();
  const since = useMemo(() => new Date(Date.now() - Number(days) * 86_400_000), [days]);
  const sinceDate = since.toISOString().slice(0, 10);
  const scopedDepot = depotId === 'ALL' ? null : depotId;

  // All three run, so switching reports is instant and the preview never
  // flashes empty. They are cheap, capped, and cached by TanStack Query.
  const attendance = useAttendance({
    depotId: scopedDepot,
    from: sinceDate,
    limit: EXPORT_LIMIT,
  });
  const trips = useTrips({
    depotId: scopedDepot,
    from: since.toISOString(),
    limit: EXPORT_LIMIT,
  });
  const anomalies = useAnomalies({
    depotId: scopedDepot,
    from: since.toISOString(),
    reviewStatus: 'ALL',
    limit: EXPORT_LIMIT,
  });

  const attendanceColumns = useMemo<CsvColumn<AttendanceWithRelations>[]>(
    () => [
      { header: t('reports.columns.date'), value: (row) => formatDate(row.attendance_date) },
      { header: t('reports.columns.driver'), value: (row) => row.employee?.full_name ?? '' },
      {
        header: t('reports.columns.employeeCode'),
        value: (row) => row.employee?.employee_code ?? '',
      },
      { header: t('reports.columns.bus'), value: (row) => row.bus?.registration_number ?? '' },
      { header: t('reports.columns.route'), value: (row) => row.route?.name ?? '' },
      { header: t('reports.columns.method'), value: (row) => row.method },
      {
        header: t('reports.columns.confidence'),
        value: (row) => (row.face_match_score == null ? '' : row.face_match_score.toFixed(3)),
      },
      { header: t('reports.columns.manualReason'), value: (row) => row.override_reason ?? '' },
      { header: t('reports.columns.recordedAt'), value: (row) => formatDateTime(row.recorded_at) },
    ],
    [t],
  );

  const tripColumns = useMemo<CsvColumn<TripWithRelations>[]>(
    () => [
      {
        header: t('reports.columns.startedAt'),
        value: (row) => formatDateTime(row.actual_start_time),
      },
      { header: t('reports.columns.endedAt'), value: (row) => formatDateTime(row.actual_end_time) },
      { header: t('reports.columns.bus'), value: (row) => row.bus?.registration_number ?? '' },
      { header: t('reports.columns.route'), value: (row) => row.route?.name ?? '' },
      { header: t('reports.columns.driver'), value: (row) => row.driver?.full_name ?? '' },
      { header: t('reports.columns.expectedKm'), value: (row) => row.expected_distance_km ?? '' },
      { header: t('reports.columns.actualKm'), value: (row) => row.calculated_distance_km ?? '' },
      {
        header: t('reports.columns.variancePct'),
        value: (row) => row.distance_variance_pct ?? '',
      },
      {
        header: t('reports.columns.efficiency'),
        value: (row) => row.calculated_efficiency_kmpl ?? '',
      },
      { header: t('reports.columns.status'), value: (row) => row.status },
    ],
    [t],
  );

  const anomalyColumns = useMemo<CsvColumn<AnomalyWithRelations>[]>(
    () => [
      { header: t('reports.columns.detectedAt'), value: (row) => formatDateTime(row.detected_at) },
      { header: t('reports.columns.alertType'), value: (row) => t(`anomalies.kinds.${row.kind}`) },
      { header: t('reports.columns.severity'), value: (row) => row.severity },
      { header: t('reports.columns.bus'), value: (row) => row.bus?.registration_number ?? '' },
      { header: t('reports.columns.driver'), value: (row) => row.driver?.full_name ?? '' },
      { header: t('reports.columns.observed'), value: (row) => row.observed_value ?? '' },
      { header: t('reports.columns.expected'), value: (row) => row.expected_value ?? '' },
      {
        // The same sentence the reviewer reads on screen, so the spreadsheet
        // carries the explanation rather than a bare rule code.
        header: t('reports.columns.whyFlagged'),
        value: (row) => explain(anomalyToExplainable(row)),
      },
      { header: t('reports.columns.reviewStatus'), value: (row) => row.review_status },
    ],
    [t, explain],
  );

  const query = report === 'attendance' ? attendance : report === 'trips' ? trips : anomalies;
  const rowCount = query.data?.length ?? 0;

  /**
   * One narrowed view of {rows, columns}. Building it in a single switch is
   * what keeps the row type and the column type provably in step — the
   * alternative is a cast at the export call, which is exactly where a
   * mismatched column would go unnoticed.
   */
  const exportCsv = () => {
    if (rowCount === 0) {
      toast({ tone: 'info', title: t('reports.exportEmpty') });
      return;
    }

    const csv =
      report === 'attendance'
        ? toCsv(attendance.data ?? [], attendanceColumns)
        : report === 'trips'
          ? toCsv(trips.data ?? [], tripColumns)
          : toCsv(anomalies.data ?? [], anomalyColumns);

    downloadCsv(exportFilename(report), csv);
    trackEvent('report_exported', { report, row_count: rowCount });
    toast({ tone: 'success', title: t('reports.exportReady') });
  };

  const previewColumns: CsvColumn<unknown>[] = (
    report === 'attendance' ? attendanceColumns : report === 'trips' ? tripColumns : anomalyColumns
  ).slice(0, 6) as CsvColumn<unknown>[];
  const previewRows: unknown[] = (query.data ?? []).slice(0, PREVIEW_ROWS);

  return (
    <div className="space-y-4">
      <PageHeader title={t('reports.title')} description={t('reports.subtitle')} />

      <Card>
        <CardContent className="space-y-4 pt-5">
          <Field label={t('reports.reportType')}>
            {(field) => (
              <Select value={report} onValueChange={(value) => setReport(value as ReportKind)}>
                <SelectTrigger id={field.id} aria-describedby={field['aria-describedby']}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="attendance">{t('reports.types.attendance')}</SelectItem>
                  <SelectItem value="trips">{t('reports.types.trips')}</SelectItem>
                  <SelectItem value="anomalies">{t('reports.types.anomalies')}</SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>

          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t('reports.filters.dateRange')}</p>
            <SegmentedControl<Window>
              label={t('reports.filters.dateRange')}
              value={days}
              onChange={setDays}
              options={[
                { value: '7', label: t('common.last7Days') },
                { value: '30', label: t('common.last30Days') },
                { value: '90', label: t('units.days', { count: 90 }) },
              ]}
            />
          </div>

          {/* Managers see only their own depots anyway; the picker is worth the
              space only when there is genuinely a choice to make. */}
          {isAdmin && (depots.data?.length ?? 0) > 1 && (
            <Field label={t('reports.filters.depot')}>
              {(field) => (
                <Select value={depotId} onValueChange={setDepotId}>
                  <SelectTrigger id={field.id} aria-describedby={field['aria-describedby']}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">{t('depots.allDepots')}</SelectItem>
                    {(depots.data ?? []).map((depot) => (
                      <SelectItem key={depot.id} value={depot.id}>
                        {depot.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          )}
        </CardContent>
      </Card>

      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {query.isPending && <SkeletonList count={3} />}

      {!query.isPending && !query.isError && (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-5">
              <div className="flex min-w-0 items-start gap-3">
                <FileSpreadsheet
                  className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    {t('reports.rowCount', { count: rowCount })}
                  </p>
                  <p className="text-sm text-muted-foreground">{t('reports.exportScope')}</p>
                </div>
              </div>
              <Button onClick={exportCsv} disabled={rowCount === 0}>
                <Download className="size-4" aria-hidden />
                {t('actions.export')}
              </Button>
            </CardContent>
          </Card>

          {rowCount > 0 && (
            <Card className="overflow-hidden">
              <div className="border-b border-border px-4 py-3">
                <p className="text-sm font-semibold">{t('reports.preview')}</p>
                <p className="text-sm text-muted-foreground">{t('reports.previewNote')}</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[42rem] text-sm">
                  <caption className="sr-only">{t(`reports.types.${report}`)}</caption>
                  <thead className="bg-muted/60">
                    <tr>
                      {previewColumns.map((column) => (
                        <th
                          key={column.header}
                          scope="col"
                          className="whitespace-nowrap px-4 py-2.5 text-left font-semibold"
                        >
                          {column.header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {previewRows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {previewColumns.map((column) => (
                          <td
                            key={column.header}
                            className="max-w-[18rem] truncate whitespace-nowrap px-4 py-2.5"
                          >
                            {column.value(row) ?? '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rowCount > PREVIEW_ROWS && (
                <p className="border-t border-border px-4 py-2.5 text-sm text-muted-foreground">
                  {t('common.showingCount', { shown: PREVIEW_ROWS, total: rowCount })}
                </p>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
