import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Bus, Plus } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { SearchInput } from '@/components/common/SearchInput';
import { FilterSheet } from '@/components/common/FilterSheet';
import { EntityCard } from '@/components/common/EntityCard';
import { BusStatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SkeletonList } from '@/components/ui/skeleton';
import { EmptyState, ErrorState, NoResultsState } from '@/components/feedback/states';
import { formatDistance } from '@/lib/format';
import { useAuth, useActiveDepot } from '@/features/auth/session';
import { useBuses, useDepots } from '@/features/fleet/api';
import { BUS_STATUSES } from '@domain/types.ts';
import type { BusStatus } from '@domain/types.ts';

export default function BusListPage() {
  const { t } = useTranslation();
  const { can, isAdmin } = useAuth();
  const activeDepot = useActiveDepot();
  const depots = useDepots();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<BusStatus | 'ALL'>('ALL');
  const [depotId, setDepotId] = useState<string | 'ALL'>(activeDepot?.id ?? 'ALL');

  const filters = {
    depotId: depotId === 'ALL' ? null : depotId,
    status,
    search,
  };
  const { data, isLoading, isError, error, refetch } = useBuses(filters);

  const activeFilterCount = (status !== 'ALL' ? 1 : 0) + (depotId !== 'ALL' ? 1 : 0);
  const hasQuery = search.trim().length > 0 || activeFilterCount > 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('buses.title')}
        action={
          can('bus.create') && (
            <Button asChild size="md">
              <Link to="/fleet/buses/new">
                <Plus className="size-4" aria-hidden />
                {t('buses.add')}
              </Link>
            </Button>
          )
        }
      />

      <div className="flex gap-2">
        <SearchInput
          className="flex-1"
          value={search}
          onChange={setSearch}
          placeholder={t('buses.searchPlaceholder')}
        />
        <FilterSheet
          activeCount={activeFilterCount}
          onClear={() => {
            setStatus('ALL');
            setDepotId('ALL');
          }}
        >
          <Field label={t('buses.status')}>
            {(fieldProps) => (
              <Select
                value={status}
                onValueChange={(value) => setStatus(value as BusStatus | 'ALL')}
              >
                <SelectTrigger id={fieldProps.id}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{t('common.all')}</SelectItem>
                  {BUS_STATUSES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`status.bus.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>

          {isAdmin && (
            <Field label={t('depots.singular')}>
              {(fieldProps) => (
                <Select value={depotId} onValueChange={setDepotId}>
                  <SelectTrigger id={fieldProps.id}>
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
        </FilterSheet>
      </div>

      {isLoading && <SkeletonList count={5} />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}

      {!isLoading && !isError && data?.length === 0 && hasQuery && (
        <NoResultsState
          query={search}
          onClear={() => {
            setSearch('');
            setStatus('ALL');
            setDepotId('ALL');
          }}
        />
      )}

      {!isLoading && !isError && data?.length === 0 && !hasQuery && (
        <EmptyState
          icon={Bus}
          title={t('empty.buses')}
          description={t('empty.busesBody')}
          action={
            can('bus.create') && (
              <Button asChild>
                <Link to="/fleet/buses/new">{t('buses.add')}</Link>
              </Button>
            )
          }
        />
      )}

      {!isLoading && (data?.length ?? 0) > 0 && (
        <ul className="space-y-3">
          {data?.map((bus) => (
            <li key={bus.id}>
              <EntityCard
                to={`/fleet/buses/${bus.id}`}
                icon={Bus}
                title={bus.registration_number}
                subtitle={[bus.fleet_number, bus.make, bus.model].filter(Boolean).join(' · ')}
                meta={
                  <>
                    <BusStatusBadge status={bus.status} />
                    <span className="tabular text-xs text-muted-foreground">
                      {t('units.kmValue', { value: formatDistance(bus.current_odometer_km, 0) })}
                    </span>
                  </>
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
