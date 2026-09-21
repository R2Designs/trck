import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollText } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { FilterSheet } from '@/components/common/FilterSheet';
import { Card, CardContent } from '@/components/ui/card';
import { Field } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { SkeletonList } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { formatDateTime } from '@/lib/format';
import { useAuditLogs } from './api';

/**
 * The audit log.
 *
 * Read-only by construction — there is no UPDATE or DELETE policy on the table
 * and a trigger blocks both even for the table owner. Before/after values are
 * available behind a disclosure rather than inline, because most of the time
 * the question is "who changed this and when", not "which of forty columns".
 */

const ENTITY_TYPES = [
  'employee',
  'bus',
  'route',
  'depot',
  'attendance',
  'trip',
  'user_role',
  'app_settings',
  'face_embedding',
] as const;

export default function AuditLogPage() {
  const { t } = useTranslation();
  const [entityType, setEntityType] = useState<string>('ALL');
  const [range, setRange] = useState<'7' | '30' | '90'>('30');

  const from = new Date(Date.now() - Number(range) * 86_400_000).toISOString();
  const { data, isLoading, isError, error, refetch } = useAuditLogs({
    entityType: entityType === 'ALL' ? null : entityType,
    from,
    limit: 200,
  });

  const activeFilters = (entityType !== 'ALL' ? 1 : 0) + (range !== '30' ? 1 : 0);

  return (
    <div className="space-y-4">
      <PageHeader title={t('audit.title')} description={t('audit.subtitle')} />

      <div className="flex justify-end">
        <FilterSheet
          activeCount={activeFilters}
          onClear={() => {
            setEntityType('ALL');
            setRange('30');
          }}
        >
          <Field label={t('audit.entity')}>
            {(fieldProps) => (
              <Select value={entityType} onValueChange={setEntityType}>
                <SelectTrigger id={fieldProps.id}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{t('common.all')}</SelectItem>
                  {ENTITY_TYPES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>

          <Field label={t('reports.filters.dateRange')}>
            {(fieldProps) => (
              <Select value={range} onValueChange={(value) => setRange(value as typeof range)}>
                <SelectTrigger id={fieldProps.id}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">{t('common.last7Days')}</SelectItem>
                  <SelectItem value="30">{t('common.last30Days')}</SelectItem>
                  <SelectItem value="90">{t('units.days', { count: 90 })}</SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>
        </FilterSheet>
      </div>

      {isLoading && <SkeletonList count={6} />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}

      {!isLoading && !isError && (data?.length ?? 0) === 0 && (
        <EmptyState
          icon={ScrollText}
          title={t('audit.title')}
          description={t('empty.filteredBody')}
        />
      )}

      <ul className="space-y-2">
        {data?.map((entry) => (
          <li key={entry.id}>
            <Card>
              <CardContent className="pt-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold">
                    {t(`audit.actions.${entry.action}`, { defaultValue: entry.action })}
                  </p>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(entry.occurred_at)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {[entry.entity_label, entry.actor_email].filter(Boolean).join(' · ')}
                </p>

                {(entry.before_values || entry.after_values) && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-semibold text-primary">
                      {t('audit.viewChanges')}
                    </summary>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {entry.before_values && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground">
                            {t('audit.before')}
                          </p>
                          <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-muted p-2 text-xs">
                            {JSON.stringify(entry.before_values, null, 2)}
                          </pre>
                        </div>
                      )}
                      {entry.after_values && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground">
                            {t('audit.after')}
                          </p>
                          <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-muted p-2 text-xs">
                            {JSON.stringify(entry.after_values, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  </details>
                )}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      {(data?.length ?? 0) >= 200 && (
        <Button variant="outline" block onClick={() => void refetch()}>
          {t('actions.refresh')}
        </Button>
      )}
    </div>
  );
}
