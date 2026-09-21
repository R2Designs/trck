import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Activity,
  Bus,
  CalendarCheck,
  CheckCircle2,
  ChevronRight,
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
import { AnomalyBadge, Badge, TripStatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { SkeletonList, SkeletonStatGrid } from '@/components/ui/skeleton';
import { ErrorState, NoDepotState } from '@/components/feedback/states';
import {
  formatDistance,
  formatEfficiency,
  formatRelativeTime,
  greetingKey,
  formatLongDate,
} from '@/lib/format';
import { useActiveDepot, useAuth, useIdentity } from '@/features/auth/session';
import { useManagerDashboard } from './api';
import { useAnomalyExplanation } from '@/features/anomalies/explain';

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
  const explain = useAnomalyExplanation();

  const { data, isLoading, isError, error, refetch } = useManagerDashboard(depot?.id ?? null);

  if (!depot) return <NoDepotState />;

  const firstName = identity.profile.full_name.split(' ')[0] ?? identity.profile.full_name;
  const today = data?.today;
  const fleet = data?.fleet ?? {};

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold leading-tight tracking-tight">
          {t(`home.greeting${greetingKey()}`, { name: firstName })}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('home.depotLine', { depot: depot.name, date: formatLongDate(new Date()) })}
        </p>
      </header>

      {/* --- Quick actions --------------------------------------------- */}
      <section>
        <SectionHeading title={t('home.quickActions')} />
        <div className="mt-2 grid grid-cols-2 gap-3">
          {can('attendance.record') && (
            <QuickAction
              to="/attendance/take"
              icon={ScanFace}
              label={t('home.takeAttendance')}
              primary
            />
          )}
          {can('trip.create') && (
            <QuickAction to="/trips/start" icon={Play} label={t('home.startTrip')} />
          )}
          {can('trip.complete') && (
            <QuickAction to="/trips" icon={Square} label={t('home.endTrip')} />
          )}
          {can('employee.create') && (
            <QuickAction to="/fleet/drivers/new" icon={Plus} label={t('home.addDriver')} />
          )}
        </div>
      </section>

      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}

      {/* --- Today ------------------------------------------------------ */}
      <section>
        <SectionHeading title={t('home.todaySummary')} />
        {isLoading ? (
          <div className="mt-2">
            <SkeletonStatGrid count={4} />
          </div>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-3">
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
              icon={Bus}
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

      {/* --- Fleet status ------------------------------------------------ */}
      <section>
        <SectionHeading
          title={t('home.fleetStatus')}
          action={
            <Link to="/fleet/buses" className="text-sm font-semibold text-primary hover:underline">
              {t('actions.viewAll')}
            </Link>
          }
        />
        <Card className="mt-2">
          <CardContent className="grid grid-cols-2 gap-3 pt-4 sm:grid-cols-4">
            {(['AVAILABLE', 'ON_TRIP', 'MAINTENANCE', 'OUT_OF_SERVICE'] as const).map((status) => (
              <div key={status}>
                <p className="tabular text-2xl font-bold leading-none">{fleet[status] ?? 0}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t(`status.bus.${status}`)}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      {/* --- Needs attention --------------------------------------------- */}
      <section>
        <SectionHeading
          title={t('home.attentionRequired')}
          action={
            (data?.attention.length ?? 0) > 0 && (
              <Link to="/alerts" className="text-sm font-semibold text-primary hover:underline">
                {t('actions.viewAll')}
              </Link>
            )
          }
        />
        {isLoading ? (
          <SkeletonList count={2} className="mt-2" />
        ) : (data?.attention.length ?? 0) === 0 ? (
          <Card className="mt-2">
            <CardContent className="flex items-center gap-2.5 pt-4 text-sm text-muted-foreground">
              <CheckCircle2 className="size-5 text-success" aria-hidden />
              {t('home.attentionEmpty')}
            </CardContent>
          </Card>
        ) : (
          <ul className="mt-2 space-y-3">
            {data?.attention.map((item) => (
              <li key={item.id}>
                <EntityCard
                  to={`/alerts/${item.id}`}
                  icon={TriangleAlert}
                  title={t(`anomalies.kinds.${item.kind}`)}
                  subtitle={explain({
                    kind: item.kind,
                    observedValue: item.observed_value,
                    expectedValue: item.expected_value,
                    variancePct: item.variance_pct,
                    detail: item.detail,
                  })}
                  meta={
                    <>
                      <AnomalyBadge severity={item.severity} size="sm" />
                      {item.bus && (
                        <span className="text-xs font-medium text-muted-foreground">
                          {item.bus.registration_number}
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
          <SkeletonList count={3} className="mt-2" />
        ) : (data?.trips.length ?? 0) === 0 ? (
          <Card className="mt-2">
            <CardContent className="pt-4 text-sm text-muted-foreground">
              {t('trips.noActiveTrips')}
            </CardContent>
          </Card>
        ) : (
          <ul className="mt-2 space-y-3">
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
          <div className="mt-2 grid grid-cols-2 gap-3">
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
          <Card className="mt-2">
            <CardContent className="divide-y divide-border pt-2">
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

      {/* Attendance summary line, for the "18 / 21" framing the brief asked for */}
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
          <Card className="mt-2">
            <CardContent className="pt-4">
              <p className="text-sm font-medium">
                {t('home.attendanceSummary', {
                  present: today.drivers_present,
                  total: today.drivers_total,
                })}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
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
    </div>
  );
}

function QuickAction({
  to,
  icon: Icon,
  label,
  primary,
}: {
  to: string;
  icon: typeof Play;
  label: string;
  primary?: boolean;
}) {
  return (
    <Button
      asChild
      variant={primary ? 'primary' : 'outline'}
      size="lg"
      className="h-auto min-h-[4.5rem] flex-col items-start justify-between gap-2 px-4 py-3 text-left"
    >
      <Link to={to}>
        <Icon className="size-5 shrink-0" aria-hidden />
        <span className="flex w-full items-center justify-between gap-1">
          <span className="line-clamp-2 text-sm font-semibold leading-tight">{label}</span>
          <ChevronRight className="size-4 shrink-0 opacity-60" aria-hidden />
        </span>
      </Link>
    </Button>
  );
}
