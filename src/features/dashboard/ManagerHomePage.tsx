import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Activity,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Fuel,
  Play,
  Plus,
  Route as RouteIcon,
  ScanFace,
  Square,
  TriangleAlert,
  Users,
} from 'lucide-react';
import { SectionHeading, Card, CardContent } from '@/components/ui/card';
import { StatCard } from '@/components/common/StatCard';
import { EntityCard } from '@/components/common/EntityCard';
import { Badge, TripStatusBadge } from '@/components/common/StatusBadge';
import { SkeletonList, SkeletonStatGrid } from '@/components/ui/skeleton';
import { ErrorState, NoDepotState } from '@/components/feedback/states';
import {
  formatDistance,
  formatEfficiency,
  formatRelativeTime,
  formatLongDate,
} from '@/lib/format';
import { useActiveDepot, useAuth, useIdentity } from '@/features/auth/session';
import { useManagerDashboard } from './api';
import { DashboardActionStrip } from './DashboardActionStrip';

/**
 * The manager's day.
 *
 * Ordered by what someone arriving at 6 a.m. actually needs, in order: what do
 * I do now, what is the state of the depot, what needs my judgement, what
 * happened recently. Not a metrics wall — every number on this screen either
 * prompts an action or answers a question a manager asks out loud.
 */
export default function ManagerHomePage() {
  const { t } = useTranslation();
  const identity = useIdentity();
  const { can } = useAuth();
  const depot = useActiveDepot();

  const { data, isLoading, isError, error, refetch } = useManagerDashboard(depot?.id ?? null);

  if (!depot) return <NoDepotState />;

  const firstName = identity.profile.full_name.split(' ')[0] ?? identity.profile.full_name;
  const today = data?.today;

  return (
    <div className="space-y-9 lg:space-y-11">
      <header className="lg:pb-2">
        <h1 className="text-3xl font-bold leading-tight tracking-[-0.025em] lg:text-4xl">
          {t('home.greeting', { name: firstName })}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground lg:text-base">
          {t('home.depotLine', { depot: depot.name, date: formatLongDate(new Date()) })}
        </p>
      </header>

      {/* --- Quick actions --------------------------------------------- */}
      <DashboardActionStrip
        title={t('home.quickActions')}
        actions={[
          ...(can('attendance.record')
            ? [{ to: '/attendance/take', icon: ScanFace, label: t('home.takeAttendance') }]
            : []),
          ...(can('trip.create')
            ? [{ to: '/trips/start', icon: Play, label: t('home.startTrip') }]
            : []),
          ...(can('trip.complete')
            ? [{ to: '/trips', icon: Square, label: t('home.endTrip') }]
            : []),
          ...(can('employee.create')
            ? [{ to: '/fleet/drivers/new', icon: Plus, label: t('home.addDriver') }]
            : []),
        ]}
      />

      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}

      {/* --- Today ------------------------------------------------------ */}
      <section>
        <SectionHeading title={t('home.todaySummary')} />
        {isLoading ? (
          <div className="mt-2">
            <SkeletonStatGrid count={4} />
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label={t('home.driversPresent')}
              value={`${today?.drivers_present ?? 0}/${today?.drivers_total ?? 0}`}
              sublabel={
                (today?.drivers_manual ?? 0) > 0
                  ? t('home.attendanceManual', { count: today?.drivers_manual ?? 0 })
                  : undefined
              }
              icon={Users}
              to="/attendance"
              tone={
                today && today.drivers_total > 0 && today.drivers_present < today.drivers_total
                  ? 'warning'
                  : 'success'
              }
            />
            <StatCard
              label={t('home.busesActive')}
              value={today?.trips_active ?? 0}
              icon={RouteIcon}
              to="/trips"
              tone="info"
            />
            <StatCard
              label={t('home.tripsCompleted')}
              value={today?.trips_completed ?? 0}
              icon={CheckCircle2}
              to="/trips"
            />
            <StatCard
              label={t('home.issuesToReview')}
              value={today?.issues_open ?? 0}
              icon={TriangleAlert}
              to="/alerts"
              tone={(today?.issues_open ?? 0) > 0 ? 'danger' : 'default'}
            />
          </div>
        )}
      </section>

      {/* --- Attendance -------------------------------------------------- */}
      {today && today.drivers_total > 0 && (
        <section>
          <SectionHeading
            title={t('home.attendanceHeading')}
            action={
              <Link to="/attendance" className="text-sm font-semibold text-primary hover:underline">
                {t('actions.viewAll')}
              </Link>
            }
          />
          <Card className="mt-3">
            <CardContent className="p-5 sm:p-6 lg:p-7">
              <p className="text-base font-semibold lg:text-lg">
                {t('home.attendanceSummary', {
                  present: today.drivers_present,
                  total: today.drivers_total,
                })}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2.5">
                <Badge tone="success" icon={CheckCircle2} size="sm">
                  {t('home.presentList')}: {today.drivers_present}
                </Badge>
                <Badge tone="warning" icon={CalendarCheck} size="sm">
                  {t('home.missingList')}:{' '}
                  {Math.max(0, today.drivers_total - today.drivers_present)}
                </Badge>
                {today.drivers_manual > 0 && (
                  <Badge tone="info" size="sm">
                    {t('home.attendanceManual', { count: today.drivers_manual })}
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* --- Today's trips ------------------------------------------------ */}
      <section>
        <SectionHeading
          title={t('home.todaysTrips')}
          action={
            <Link to="/trips" className="text-sm font-semibold text-primary hover:underline">
              {t('actions.viewAll')}
            </Link>
          }
        />
        {isLoading ? (
          <SkeletonList count={3} className="mt-3" />
        ) : (data?.trips.length ?? 0) === 0 ? (
          <Card className="mt-3">
            <CardContent className="p-5 text-sm text-muted-foreground sm:p-6">
              {t('trips.noActiveTrips')}
            </CardContent>
          </Card>
        ) : (
          <ul className="mt-3 space-y-4">
            {data?.trips.slice(0, 6).map((trip) => (
              <li key={trip.id}>
                <EntityCard
                  to={`/trips/${trip.id}`}
                  icon={RouteIcon}
                  highlight={trip.status === 'STARTED'}
                  title={trip.bus.registration_number}
                  subtitle={`${trip.route.name}${trip.driver ? ` · ${trip.driver.full_name}` : ''}`}
                  meta={
                    <>
                      <TripStatusBadge status={trip.status} />
                      {trip.started_at && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="size-3" aria-hidden />
                          {formatRelativeTime(trip.started_at)}
                        </span>
                      )}
                    </>
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --- Distance and fuel -------------------------------------------- */}
      <section>
        <SectionHeading
          title={t('home.performance')}
          action={
            <span className="text-xs text-muted-foreground">
              {t('home.performanceWindow', { days: data?.performance.window_days ?? 7 })}
            </span>
          }
        />
        {isLoading ? (
          <div className="mt-2">
            <SkeletonStatGrid count={2} />
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label={t('home.distanceTravelled')}
              value={t('units.kmValue', {
                value: formatDistance(data?.performance.distance_km ?? 0, 0),
              })}
              icon={RouteIcon}
            />
            <StatCard
              label={t('home.averageEfficiency')}
              value={
                data?.performance.avg_efficiency_kmpl != null
                  ? t('units.kmplValue', {
                      value: formatEfficiency(data.performance.avg_efficiency_kmpl),
                    })
                  : '—'
              }
              icon={Fuel}
            />
            <StatCard
              label={t('home.tripsCompleted')}
              value={data?.performance.trips ?? 0}
              icon={CheckCircle2}
            />
            <StatCard
              label={t('home.tripsWithAnomalies')}
              value={data?.performance.trips_with_anomalies ?? 0}
              icon={TriangleAlert}
              tone={(data?.performance.trips_with_anomalies ?? 0) > 0 ? 'warning' : 'default'}
            />
          </div>
        )}
      </section>

      {/* --- Recent activity ---------------------------------------------- */}
      {(data?.recent_activity.length ?? 0) > 0 && (
        <section>
          <SectionHeading title={t('home.recentActivity')} />
          <Card className="mt-3">
            <CardContent className="divide-y divide-border p-5 sm:p-6">
              {data?.recent_activity.slice(0, 8).map((entry) => (
                <div key={entry.id} className="flex items-start gap-2.5 py-2.5">
                  <Activity className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {t(`audit.actions.${entry.action}`, { defaultValue: entry.action })}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[entry.entity_label, entry.actor].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatRelativeTime(entry.occurred_at)}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      )}

    </div>
  );
}
