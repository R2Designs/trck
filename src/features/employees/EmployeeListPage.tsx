import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Plus, Users } from 'lucide-react';
import type { EmployeeType, EmploymentStatus } from '@domain/types.ts';
import { EMPLOYEE_TYPES, EMPLOYMENT_STATUSES } from '@domain/types.ts';
import { PageHeader } from '@/components/common/PageHeader';
import { SearchInput } from '@/components/common/SearchInput';
import { FilterSheet } from '@/components/common/FilterSheet';
import { EntityCard, initialsOf } from '@/components/common/EntityCard';
import { Badge, EmploymentStatusBadge } from '@/components/common/StatusBadge';
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
import { differenceInDays } from 'date-fns';
import { useActiveDepot, useAuth } from '@/features/auth/session';
import { useEmployees } from '@/features/fleet/api';

/**
 * Drivers and staff.
 *
 * A licence expiring inside 30 days is surfaced on the row rather than left
 * for a report — it is the kind of thing that only becomes urgent once it is
 * already a problem.
 */
export default function EmployeeListPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const depot = useActiveDepot();

  const [search, setSearch] = useState('');
  const [type, setType] = useState<EmployeeType | 'ALL'>('ALL');
  const [status, setStatus] = useState<EmploymentStatus | 'ALL'>('ACTIVE');

  const { data, isLoading, isError, error, refetch } = useEmployees({
    depotId: depot?.id ?? null,
    type,
    status,
    search,
  });

  const activeFilters = (type !== 'ALL' ? 1 : 0) + (status !== 'ACTIVE' ? 1 : 0);
  const hasQuery = search.trim().length > 0 || activeFilters > 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('employees.title')}
        description={depot?.name}
        action={
          can('employee.create') && (
            <Button asChild size="md">
              <Link to="/fleet/drivers/new">
                <Plus className="size-4" aria-hidden />
                {t('employees.add')}
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
          placeholder={t('employees.searchPlaceholder')}
        />
        <FilterSheet
          activeCount={activeFilters}
          onClear={() => {
            setType('ALL');
            setStatus('ACTIVE');
          }}
        >
          <Field label={t('employees.filterByType')}>
            {(fieldProps) => (
              <Select
                value={type}
                onValueChange={(value) => setType(value as EmployeeType | 'ALL')}
              >
                <SelectTrigger id={fieldProps.id}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{t('common.all')}</SelectItem>
                  {EMPLOYEE_TYPES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`employeeType.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field label={t('employees.filterByStatus')}>
            {(fieldProps) => (
              <Select
                value={status}
                onValueChange={(value) => setStatus(value as EmploymentStatus | 'ALL')}
              >
                <SelectTrigger id={fieldProps.id}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{t('common.all')}</SelectItem>
                  {EMPLOYMENT_STATUSES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`status.employment.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
        </FilterSheet>
      </div>

      {isLoading && <SkeletonList count={5} />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}

      {!isLoading && !isError && (data?.length ?? 0) === 0 && hasQuery && (
        <NoResultsState
          query={search}
          onClear={() => {
            setSearch('');
            setType('ALL');
            setStatus('ACTIVE');
          }}
        />
      )}

      {!isLoading && !isError && (data?.length ?? 0) === 0 && !hasQuery && (
        <EmptyState
          icon={Users}
          title={t('empty.employees')}
          description={t('empty.employeesBody')}
          action={
            can('employee.create') && (
              <Button asChild>
                <Link to="/fleet/drivers/new">{t('employees.add')}</Link>
              </Button>
            )
          }
        />
      )}

      <ul className="space-y-3">
        {data?.map((employee) => {
          const daysToExpiry = employee.licence_expiry
            ? differenceInDays(new Date(employee.licence_expiry), new Date())
            : null;
          const expiringSoon = daysToExpiry != null && daysToExpiry >= 0 && daysToExpiry <= 30;
          const expired = daysToExpiry != null && daysToExpiry < 0;

          return (
            <li key={employee.id}>
              <EntityCard
                to={`/fleet/drivers/${employee.id}`}
                avatarText={initialsOf(employee.full_name)}
                title={employee.full_name}
                subtitle={`${employee.employee_code} · ${t(`employeeType.${employee.employee_type}`)}`}
                meta={
                  <>
                    <EmploymentStatusBadge status={employee.employment_status} />
                    {expired && (
                      <Badge tone="danger" size="sm">
                        {t('employees.licenceExpired')}
                      </Badge>
                    )}
                    {expiringSoon && (
                      <Badge tone="warning" size="sm">
                        {t('employees.licenceExpiringSoon', { count: daysToExpiry })}
                      </Badge>
                    )}
                  </>
                }
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
