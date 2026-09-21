import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Building2,
  Bus,
  ChevronRight,
  Play,
  Route as RouteIcon,
  ScanFace,
  Square,
  UserCog,
  Users,
} from 'lucide-react';
import { Card, CardContent, SectionHeading } from '@/components/ui/card';
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
    <div className="space-y-9 lg:space-y-11">
      <header className="lg:pb-2">
        <h1 className="text-3xl font-bold leading-tight tracking-[-0.025em] lg:text-4xl">
          {t('admin.title')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground lg:text-base">
          {t('admin.subtitle', {
            organisation: identity.organizationName,
            date: formatLongDate(new Date()),
          })}
        </p>
      </header>

      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}

      <section>
        <SectionHeading title={t('nav.overview')} />
        {isLoading ? (
          <div className="mt-3">
            <SkeletonStatGrid count={5} />
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5 lg:gap-4">
            <StatCard
              label={t('admin.activeManagers')}
              value={totals?.managers ?? 0}
              icon={UserCog}
              to="/admin/managers"
              className="lg:min-h-32 lg:p-5"
            />
            <StatCard
              label={t('admin.activeDrivers')}
              value={totals?.drivers ?? 0}
              icon={Users}
              to="/fleet/drivers"
              className="lg:min-h-32 lg:p-5"
            />
            <StatCard
              label={t('admin.activeBuses')}
              value={totals?.buses ?? 0}
              icon={Bus}
              to="/fleet/buses"
              className="lg:min-h-32 lg:p-5"
            />
            <StatCard
              label={t('admin.depots')}
              value={totals?.depots ?? 0}
              icon={Building2}
              to="/admin/depots"
              className="lg:min-h-32 lg:p-5"
            />
            <StatCard
              label={t('admin.routes')}
              value={totals?.routes ?? 0}
              icon={RouteIcon}
              to="/fleet/routes"
              className="lg:min-h-32 lg:p-5"
            />
          </div>
        )}
      </section>

      <section>
        <SectionHeading title={t('home.quickActions')} />
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3 lg:gap-4">
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
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:gap-4">
            <StatCard
              label={t('admin.attendanceRate')}
              value={
                data?.attendance_rate_today != null
                  ? formatPercent(data.attendance_rate_today, { decimals: 0 })
                  : '—'
              }
              className="lg:min-h-36 lg:p-6"
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
              className="lg:min-h-36 lg:p-6"
            />
          </div>
        )}
      </section>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(22rem,0.72fr)_minmax(0,1.28fr)] lg:gap-6">
        <section>
          <SectionHeading title={t('admin.fleetAvailability')} />
          <Card className="mt-3">
            <CardContent className="grid grid-cols-2 gap-x-6 gap-y-8 p-5 sm:grid-cols-4 sm:p-6 lg:grid-cols-2 lg:p-7 xl:grid-cols-4">
              {(['AVAILABLE', 'ON_TRIP', 'MAINTENANCE', 'OUT_OF_SERVICE'] as const).map(
                (status) => (
                  <div key={status}>
                    <p className="tabular text-2xl font-bold leading-none">
                      {data?.fleet_availability[status] ?? 0}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t(`status.bus.${status}`)}
                    </p>
                  </div>
                ),
              )}
            </CardContent>
          </Card>
        </section>

        <TrendChart
          title={t('admin.charts.distance')}
          data={data?.series.distance ?? []}
          kind="bar"
          unitSuffix={t('units.km')}
        />
      </div>
    </div>
  );
}

function AdminAction({ to, icon: Icon, label }: { to: string; icon: typeof Play; label: string }) {
  return (
    <Button
      asChild
      variant="outline"
      size="lg"
      className="min-h-14 justify-start gap-3 px-4 lg:min-h-16 lg:px-5"
    >
      <Link to={to}>
        <Icon className="size-5" aria-hidden />
        <span className="flex-1 text-left">{label}</span>
        <ChevronRight className="size-4 opacity-50" aria-hidden />
      </Link>
    </Button>
  );
}
