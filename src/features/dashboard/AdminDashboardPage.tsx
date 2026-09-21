import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ChevronRight, Play, Route as RouteIcon, ScanFace, Square, Users } from 'lucide-react';
import { SectionHeading } from '@/components/ui/card';
import { StatCard } from '@/components/common/StatCard';
import { TrendChart } from '@/components/charts/TrendChart';
import { Button } from '@/components/ui/button';
import { SkeletonStatGrid } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/feedback/states';
import { formatLongDate, formatPercent } from '@/lib/format';
import { useIdentity } from '@/features/auth/session';
import { useAdminDashboard } from './api';

/**
 * Organisation overview.
 *
 * A deliberately focused operational landing page. Deeper organisation data
 * remains available from the navigation instead of competing for attention
 * here.
 */
export default function AdminDashboardPage() {
  const { t } = useTranslation();
  const identity = useIdentity();
  const { data, isLoading, isError, error, refetch } = useAdminDashboard(30);
  const totals = data?.totals;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold leading-tight tracking-tight">{t('admin.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('admin.subtitle', {
            organisation: identity.organizationName,
            date: formatLongDate(new Date()),
          })}
        </p>
      </header>

      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}

      <section className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <SectionHeading title={t('nav.overview')} />
        <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-5">
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
              className="min-h-20 bg-card p-3 transition-colors hover:bg-muted/50"
            >
              <span className="tabular block text-2xl font-bold leading-none">
                {isLoading ? '—' : metric.value}
              </span>
              <span className="mt-2 block text-xs font-medium text-muted-foreground">
                {metric.label}
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <SectionHeading title={t('home.quickActions')} />
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <AdminAction to="/attendance/take" icon={ScanFace} label={t('home.takeAttendance')} />
          <AdminAction to="/trips/start" icon={Play} label={t('home.startTrip')} />
          <AdminAction to="/trips" icon={Square} label={t('home.endTrip')} />
        </div>
      </section>

      {/* --- Today ------------------------------------------------------- */}
      <section>
        <SectionHeading title={t('common.today')} />
        {isLoading ? (
          <div className="mt-2">
            <SkeletonStatGrid count={2} />
          </div>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-3">
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
          </div>
        )}
      </section>

      <section className="max-w-xl">
        <SectionHeading title={t('admin.fleetAvailability')} />
        <dl className="mt-2 divide-y divide-border/60 border-y border-border/60">
          {(['AVAILABLE', 'ON_TRIP', 'MAINTENANCE', 'OUT_OF_SERVICE'] as const).map((status) => (
            <div key={status} className="flex items-center justify-between gap-4 py-2.5">
              <dt className="text-sm text-muted-foreground">{t(`status.bus.${status}`)}</dt>
              <dd className="tabular text-sm font-semibold">
                {data?.fleet_availability[status] ?? 0}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <TrendChart
          title={t('admin.charts.distance')}
          data={data?.series.distance ?? []}
          kind="bar"
          unitSuffix={t('units.km')}
          compact
        />
        <TrendChart
          title={t('admin.charts.anomalies')}
          data={data?.series.anomalies ?? []}
          kind="bar"
          compact
        />
      </section>
    </div>
  );
}

function AdminAction({ to, icon: Icon, label }: { to: string; icon: typeof Play; label: string }) {
  return (
    <Button asChild variant="outline" size="lg" className="justify-start gap-3">
      <Link to={to}>
        <Icon className="size-5" aria-hidden />
        <span className="flex-1 text-left">{label}</span>
        <ChevronRight className="size-4 opacity-50" aria-hidden />
      </Link>
    </Button>
  );
}
