import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Route as RouteIcon, TriangleAlert, Users } from 'lucide-react';
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

      <div className="grid gap-6 md:grid-cols-2">
        <section>
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

        <section>
          <SectionHeading title={t('nav.overview')} />
          <ul className="mt-2 divide-y divide-border/60 border-y border-border/60">
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
              <li key={metric.to}>
                <Link
                  to={metric.to}
                  className="flex items-center justify-between gap-4 py-2.5 text-sm hover:text-primary"
                >
                  <span className="text-muted-foreground">{metric.label}</span>
                  <span className="tabular font-semibold text-foreground">{metric.value}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
