import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Route as RouteIcon, Users } from 'lucide-react';
import { SectionHeading } from '@/components/ui/card';
import { StatCard } from '@/components/common/StatCard';
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

      <section className="rounded-2xl border-2 border-primary/30 bg-primary-muted/30 p-4 sm:p-5">
        <SectionHeading title={t('nav.overview')} />
        <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-primary/20 bg-primary/15 sm:grid-cols-5">
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
              className="min-h-20 bg-background/80 p-3 transition-colors hover:bg-background"
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
    </div>
  );
}
