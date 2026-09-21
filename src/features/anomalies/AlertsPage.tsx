import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, TriangleAlert } from 'lucide-react';
import type { AnomalySeverity } from '@domain/types.ts';
import { ANOMALY_SEVERITIES } from '@domain/types.ts';
import { PageHeader } from '@/components/common/PageHeader';
import { EntityCard } from '@/components/common/EntityCard';
import { AnomalyBadge, ReviewStatusBadge } from '@/components/common/StatusBadge';
import { FilterSheet } from '@/components/common/FilterSheet';
import { Field } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/controls';
import { SkeletonList } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { formatRelativeTime } from '@/lib/format';
import { useActiveDepot, useAuth } from '@/features/auth/session';
import { useAnomalies } from './api';
import { useAnomalyExplanation, anomalyToExplainable } from './explain';

/**
 * The review queue.
 *
 * Ordered by severity then recency, because a manager with five spare minutes
 * should spend them on the most unusual thing, not the most recent. Each row
 * carries its one-line explanation so the list itself is readable without
 * opening anything.
 */
export default function AlertsPage() {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const depot = useActiveDepot();
  const explain = useAnomalyExplanation();

  const [tab, setTab] = useState('open');
  const [severity, setSeverity] = useState<AnomalySeverity | 'ALL'>('ALL');

  const open = useAnomalies({
    depotId: isAdmin ? null : (depot?.id ?? null),
    reviewStatus: 'OPEN_ONLY',
    severity,
  });
  const resolved = useAnomalies({
    depotId: isAdmin ? null : (depot?.id ?? null),
    reviewStatus: 'ALL',
    severity,
    limit: 40,
  });

  const resolvedOnly = (resolved.data ?? []).filter(
    (anomaly) => !['OPEN', 'IN_REVIEW', 'NEEDS_INVESTIGATION'].includes(anomaly.review_status),
  );

  return (
    <div className="space-y-4">
      <PageHeader title={t('anomalies.title')} description={t('anomalies.subtitle')} />

      <div className="flex justify-end">
        <FilterSheet activeCount={severity !== 'ALL' ? 1 : 0} onClear={() => setSeverity('ALL')}>
          <Field label={t('reports.filters.severity')}>
            {(fieldProps) => (
              <Select
                value={severity}
                onValueChange={(value) => setSeverity(value as AnomalySeverity | 'ALL')}
              >
                <SelectTrigger id={fieldProps.id}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{t('common.all')}</SelectItem>
                  {ANOMALY_SEVERITIES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`status.severity.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
        </FilterSheet>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="open">
            {t('anomalies.open')}
            {(open.data?.length ?? 0) > 0 && (
              <span className="ml-1.5 grid size-5 place-items-center rounded-full bg-warning text-xs font-bold text-warning-foreground">
                {open.data?.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="resolved">{t('anomalies.resolved')}</TabsTrigger>
        </TabsList>

        <TabsContent value="open" className="space-y-3">
          {open.isLoading && <SkeletonList count={4} />}
          {open.isError && <ErrorState error={open.error} onRetry={() => void open.refetch()} />}
          {!open.isLoading && (open.data?.length ?? 0) === 0 && (
            <EmptyState
              icon={ShieldCheck}
              title={t('anomalies.empty')}
              description={t('empty.anomaliesBody')}
            />
          )}
          <ul className="space-y-3">
            {open.data?.map((anomaly) => (
              <li key={anomaly.id}>
                <EntityCard
                  to={`/alerts/${anomaly.id}`}
                  icon={TriangleAlert}
                  title={t(`anomalies.kinds.${anomaly.kind}`)}
                  subtitle={explain(anomalyToExplainable(anomaly))}
                  meta={
                    <>
                      <AnomalyBadge severity={anomaly.severity} size="sm" />
                      {anomaly.bus && (
                        <span className="text-xs font-medium text-muted-foreground">
                          {anomaly.bus.registration_number}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {formatRelativeTime(anomaly.detected_at)}
                      </span>
                    </>
                  }
                />
              </li>
            ))}
          </ul>
          {(open.data?.length ?? 0) > 0 && (
            <p className="px-1 text-xs text-muted-foreground">{t('anomalies.severityHint')}</p>
          )}
        </TabsContent>

        <TabsContent value="resolved" className="space-y-3">
          {resolved.isLoading && <SkeletonList count={3} />}
          {!resolved.isLoading && resolvedOnly.length === 0 && (
            <EmptyState title={t('empty.anomalies')} description={t('empty.anomaliesBody')} />
          )}
          <ul className="space-y-3">
            {resolvedOnly.map((anomaly) => (
              <li key={anomaly.id}>
                <EntityCard
                  to={`/alerts/${anomaly.id}`}
                  icon={TriangleAlert}
                  title={t(`anomalies.kinds.${anomaly.kind}`)}
                  subtitle={anomaly.bus?.registration_number ?? ''}
                  meta={
                    <>
                      <ReviewStatusBadge status={anomaly.review_status} />
                      <span className="text-xs text-muted-foreground">
                        {formatRelativeTime(anomaly.resolved_at ?? anomaly.detected_at)}
                      </span>
                    </>
                  }
                />
              </li>
            ))}
          </ul>
        </TabsContent>
      </Tabs>
    </div>
  );
}
