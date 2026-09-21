import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { CheckCircle2, Gauge, Route as RouteIcon, TriangleAlert, Users } from 'lucide-react';
import { SectionHeading, Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatCard } from '@/components/common/StatCard';
import { EntityCard } from '@/components/common/EntityCard';
import { Badge } from '@/components/common/StatusBadge';
import { TrendChart } from '@/components/charts/TrendChart';
import { SegmentedControl } from '@/components/ui/controls';
import { SkeletonList, SkeletonStatGrid } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/feedback/states';
import { formatDistance, formatLongDate, formatPercent } from '@/lib/format';
import { useIdentity } from '@/features/auth/session';
import { useAdminDashboard } from './api';

/**
 * Organisation overview.
 *
 * Built for a desk rather than a bus door: wider grids, trends over time, and
 * drill-downs into a depot, a bus, or a driver. Everything still works at
 * 360 px, because an administrator checking on a Sunday evening is on a phone
 * like everyone else.
 */
export default function AdminDashboardPage() {
  const { t } = useTranslation();
  const identity = useIdentity();
  const [days, setDays] = useState<'7' | '30' | '90'>('30');

  const { data, isLoading, isError, error, refetch } = useAdminDashboard(Number(days));
  const totals = data?.totals;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold leading-tight tracking-tight">{t('admin.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('admin.subtitle', {
              organisation: identity.organizationName,
              date: formatLongDate(new Date()),
            })}
          </p>
        </div>
        <SegmentedControl
          className="sm:w-64"
          label={t('reports.filters.dateRange')}
          value={days}
          onChange={setDays}
          options={[
            { value: '7', label: t('common.last7Days') },
            { value: '30', label: t('common.last30Days') },
            { value: '90', label: t('units.days', { count: 90 }) },
          ]}
        />
      </header>

      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}

      {/* --- Today ------------------------------------------------------- */}
      <section>
        <SectionHeading title={t('common.today')} />
        {isLoading ? (
          <div className="mt-2">
            <SkeletonStatGrid count={4} />
          </div>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label={t('admin.attendanceRate')}
              value={
                data?.attendance_rate_today != null
                  ? formatPercent(data.attendance_rate_today, { decimals: 0 })
                  : '—'
              }
              icon={Users}
              to="/attendance"
              tone={
                data?.attendance_rate_today != null && data.attendance_rate_today < 85
                  ? 'warning'
                  : 'success'
              }
            />
            <StatCard
              label={t('admin.tripsToday')}
              value={totals?.trips_today ?? 0}
              sublabel={t('home.tripsCompleted') + `: ${totals?.trips_completed_today ?? 0}`}
              icon={RouteIcon}
              to="/trips"
            />
            <StatCard
              label={t('admin.openAnomalies')}
              value={totals?.anomalies_open ?? 0}
              icon={TriangleAlert}
              to="/alerts"
              tone={(totals?.anomalies_open ?? 0) > 0 ? 'warning' : 'default'}
            />
            <StatCard
              label={t('admin.highSeverity')}
              value={totals?.anomalies_high ?? 0}
              icon={TriangleAlert}
              to="/alerts"
              tone={(totals?.anomalies_high ?? 0) > 0 ? 'danger' : 'default'}
            />
          </div>
        )}
      </section>

      {/* --- Secondary fleet context ------------------------------------- */}
      <section className="space-y-3 rounded-xl border border-border/60 bg-card/30 p-3">
        <div>
          <SectionHeading title={t('admin.fleetAvailability')} />
          <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {(['AVAILABLE', 'ON_TRIP', 'MAINTENANCE', 'OUT_OF_SERVICE'] as const).map((status) => (
              <div
                key={status}
                className="flex min-h-10 items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5"
              >
                <p className="tabular text-sm font-bold">{data?.fleet_availability[status] ?? 0}</p>
                <p className="truncate text-[0.6875rem] text-muted-foreground">
                  {t(`status.bus.${status}`)}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <SectionHeading title={t('nav.overview')} />
          {isLoading ? (
            <div className="mt-1.5">
              <SkeletonStatGrid count={4} />
            </div>
          ) : (
            <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-5">
              {[
                {
                  label: t('admin.activeManagers'),
                  value: totals?.managers ?? 0,
                  to: '/admin/managers',
                },
                {
                  label: t('admin.activeDrivers'),
                  value: totals?.drivers ?? 0,
                  to: '/fleet/drivers',
                },
                { label: t('admin.activeBuses'), value: totals?.buses ?? 0, to: '/fleet/buses' },
                { label: t('admin.depots'), value: totals?.depots ?? 0, to: '/admin/depots' },
                { label: t('admin.routes'), value: totals?.routes ?? 0, to: '/fleet/routes' },
              ].map((metric) => (
                <Link
                  key={metric.to}
                  to={metric.to}
                  className="flex min-h-10 items-center gap-2 rounded-md px-2.5 py-1.5 hover:bg-muted/50"
                >
                  <span className="tabular text-sm font-bold">{metric.value}</span>
                  <span className="truncate text-[0.6875rem] text-muted-foreground">
                    {metric.label}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* --- Trends -------------------------------------------------------- */}
      <section className="grid gap-3 md:grid-cols-2">
        <TrendChart
          title={t('admin.charts.attendance')}
          data={data?.series.attendance ?? []}
          kind="line"
          compact
        />
        <TrendChart
          title={t('admin.charts.distance')}
          data={data?.series.distance ?? []}
          kind="bar"
          unitSuffix={t('units.km')}
          compact
        />
        <TrendChart
          title={t('admin.charts.efficiency')}
          data={data?.series.efficiency ?? []}
          kind="line"
          unitSuffix={t('units.kmpl')}
          decimals={2}
          compact
        />
        <TrendChart
          title={t('admin.charts.anomalies')}
          data={data?.series.anomalies ?? []}
          kind="bar"
          compact
        />
      </section>

      {/* --- Depot comparison ----------------------------------------------- */}
      <section>
        <SectionHeading title={t('admin.charts.depotComparison')} />
        {isLoading ? (
          <SkeletonList count={2} className="mt-2" />
        ) : (
          <Card className="mt-2 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-xs">
                <caption className="sr-only">{t('admin.charts.depotComparison')}</caption>
                <thead className="bg-muted">
                  <tr>
                    <th scope="col" className="px-3 py-1.5 text-left font-semibold">
                      {t('depots.singular')}
                    </th>
                    <th scope="col" className="px-3 py-1.5 text-right font-semibold">
                      {t('nav.buses')}
                    </th>
                    <th scope="col" className="px-3 py-1.5 text-right font-semibold">
                      {t('nav.drivers')}
                    </th>
                    <th scope="col" className="px-3 py-1.5 text-right font-semibold">
                      {t('nav.trips')}
                    </th>
                    <th scope="col" className="px-3 py-1.5 text-right font-semibold">
                      {t('home.distanceTravelled')}
                    </th>
                    <th scope="col" className="px-3 py-1.5 text-right font-semibold">
                      {t('anomalies.title')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data?.depot_comparison.map((depot) => (
                    <tr key={depot.depot_id}>
                      <td className="px-3 py-1.5 font-medium">{depot.name}</td>
                      <td className="tabular px-3 py-1.5 text-right">{depot.buses}</td>
                      <td className="tabular px-3 py-1.5 text-right">{depot.drivers}</td>
                      <td className="tabular px-3 py-1.5 text-right">{depot.trips}</td>
                      <td className="tabular px-3 py-1.5 text-right">
                        {formatDistance(depot.distance_km, 0)}
                      </td>
                      <td className="tabular px-3 py-1.5 text-right">
                        {depot.anomalies > 0 ? (
                          <Badge tone="warning" size="sm">
                            {depot.anomalies}
                          </Badge>
                        ) : (
                          depot.anomalies
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>

      {/* --- Repeatedly flagged buses ---------------------------------------- */}
      <section>
        <SectionHeading
          title={t('admin.charts.repeatOffenders')}
          action={
            <Link to="/alerts" className="text-sm font-semibold text-primary hover:underline">
              {t('actions.viewAll')}
            </Link>
          }
        />
        {isLoading ? (
          <SkeletonList count={3} className="mt-2" />
        ) : (data?.repeat_offenders.length ?? 0) === 0 ? (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-border/70 bg-card/50 px-3 py-2 text-xs text-muted-foreground">
            <CheckCircle2 className="size-4 text-success" aria-hidden />
            {t('anomalies.empty')}
          </div>
        ) : (
          <ul className="mt-2 space-y-3">
            {data?.repeat_offenders.map((bus) => (
              <li key={bus.bus_id}>
                <EntityCard
                  to={`/fleet/buses/${bus.bus_id}`}
                  icon={Gauge}
                  title={bus.registration_number}
                  subtitle={t('common.resultCount', { count: bus.count })}
                  meta={
                    <Badge tone="warning" size="sm">
                      {bus.count}
                    </Badge>
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{t('admin.drillDown.organisation')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {[
            { to: '/admin/depots', label: t('admin.drillDown.depot') },
            { to: '/fleet/buses', label: t('admin.drillDown.bus') },
            { to: '/trips', label: t('admin.drillDown.trip') },
            { to: '/fleet/drivers', label: t('admin.drillDown.driver') },
            { to: '/attendance', label: t('admin.drillDown.attendanceHistory') },
            { to: '/admin/audit', label: t('nav.auditLog') },
          ].map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:border-primary/50"
            >
              {link.label}
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
