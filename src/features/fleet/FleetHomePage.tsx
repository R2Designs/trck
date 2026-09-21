import { useTranslation } from 'react-i18next';
import { Bus, Route as RouteIcon, Users } from 'lucide-react';
import { EntityCard } from '@/components/common/EntityCard';
import { PageHeader } from '@/components/common/PageHeader';
import { useAuth, useActiveDepot } from '@/features/auth/session';
import { useBuses, useEmployees, useRoutes } from './api';

/**
 * Fleet hub.
 *
 * Exists because "Fleet" is one tab on the bottom bar but three collections
 * underneath. Each row carries a live count, so the manager can see at a
 * glance whether anything is missing before tapping in.
 */
export default function FleetHomePage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const depot = useActiveDepot();
  const depotId = depot?.id ?? null;

  const buses = useBuses({ depotId });
  const drivers = useEmployees({ depotId, type: 'DRIVER' });
  const routes = useRoutes({ depotId });

  const countLabel = (count: number | undefined, loading: boolean) =>
    loading ? t('loading.generic') : t('common.resultCount', { count: count ?? 0 });

  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.fleet')} description={depot?.name} />

      <div className="space-y-3">
        {can('bus.view') && (
          <EntityCard
            to="/fleet/buses"
            icon={Bus}
            title={t('nav.buses')}
            subtitle={countLabel(buses.data?.length, buses.isLoading)}
          />
        )}
        {can('employee.view') && (
          <EntityCard
            to="/fleet/drivers"
            icon={Users}
            title={t('nav.drivers')}
            subtitle={countLabel(drivers.data?.length, drivers.isLoading)}
          />
        )}
        {can('route.view') && (
          <EntityCard
            to="/fleet/routes"
            icon={RouteIcon}
            title={t('nav.routes')}
            subtitle={countLabel(routes.data?.length, routes.isLoading)}
          />
        )}
      </div>
    </div>
  );
}
