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
    <div className="space-y-8 md:space-y-6">
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

      <section>
        <SectionHeading title={t('nav.overview')} />
        {isLoading ? (
          <div className="mt-3">
            <SkeletonStatGrid count={5} />
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-3 lg:grid-cols-5">
            <StatCard
              label={t('admin.activeManagers')}
              value={totals?.managers ?? 0}
              icon={UserCog}
              to="/admin/managers"
            />
            <StatCard
              label={t('admin.activeDrivers')}
              value={totals?.drivers ?? 0}
              icon={Users}
              to="/fleet/drivers"
            />
            <StatCard
              label={t('admin.activeBuses')}
              value={totals?.buses ?? 0}
              icon={Bus}
              to="/fleet/buses"
            />
            <StatCard
              label={t('admin.depots')}
              value={totals?.depots ?? 0}
              icon={Building2}
              to="/admin/depots"
            />
            <StatCard
              label={t('admin.routes')}
              value={totals?.routes ?? 0}
              icon={RouteIcon}
              to="/fleet/routes"
            />
          </div>
        )}
      </section>

      <section>
        <SectionHeading title={t('home.quickActions')} />
        <div className="mt-3 grid grid-cols-1 gap-3 sm:mt-2 sm:grid-cols-3 sm:gap-2">
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
          <div className="mt-3 grid grid-cols-1 gap-4 sm:mt-2 sm:grid-cols-2 sm:gap-3">
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

      <div className="grid items-start gap-8 md:gap-6 lg:grid-cols-[minmax(20rem,0.75fr)_minmax(0,1.25fr)]">
        <section>
          <SectionHeading title={t('admin.fleetAvailability')} />
          <Card className="mt-3 sm:mt-2">
            <CardContent className="grid grid-cols-2 gap-x-5 gap-y-6 pt-5 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
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
          compact
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
      className="min-h-14 justify-start gap-3 px-4 sm:min-h-touch"
    >
      <Link to={to}>
        <Icon className="size-5" aria-hidden />
        <span className="flex-1 text-left">{label}</span>
        <ChevronRight className="size-4 opacity-50" aria-hidden />
      </Link>
    </Button>
  );
}
