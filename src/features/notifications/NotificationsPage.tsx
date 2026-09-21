import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { EntityCard } from '@/components/common/EntityCard';
import { Badge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { SkeletonList } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import {
  notificationCopyKeys,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from './api';

/**
 * In-app notifications.
 *
 * Notifications store translation *keys* and parameters, never rendered
 * sentences, so one written while the manager's language was English still
 * reads correctly after they switch to Tamil.
 */
export default function NotificationsPage() {
  const { t } = useTranslation();
  const { data, isLoading, isError, error, refetch } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const unread = (data ?? []).filter((notification) => !notification.read_at);

  const linkFor = (entityType: string | null, entityId: string | null): string | undefined => {
    if (!entityId) return undefined;
    switch (entityType) {
      case 'trip':
        return `/trips/${entityId}`;
      case 'employee':
        return `/fleet/drivers/${entityId}`;
      case 'bus':
        return `/fleet/buses/${entityId}`;
      case 'anomaly':
        return `/alerts/${entityId}`;
      default:
        return undefined;
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('notifications.title')}
        action={
          unread.length > 0 && (
            <Button
              variant="outline"
              size="md"
              loading={markAllRead.isPending}
              onClick={() => markAllRead.mutate()}
            >
              <CheckCheck className="size-4" aria-hidden />
              {t('notifications.markAllRead')}
            </Button>
          )
        }
      />

      {isLoading && <SkeletonList count={4} />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}

      {!isLoading && !isError && (data?.length ?? 0) === 0 && (
        <EmptyState
          icon={Bell}
          title={t('empty.notifications')}
          description={t('notifications.empty')}
        />
      )}

      <ul className="space-y-3">
        {data?.map((notification) => {
          const copy = notificationCopyKeys(notification);
          const to = linkFor(notification.entity_type, notification.entity_id);
          const isUnread = !notification.read_at;

          return (
            <li key={notification.id}>
              <EntityCard
                to={to}
                onClick={!to && isUnread ? () => markRead.mutate(notification.id) : undefined}
                icon={Bell}
                highlight={isUnread}
                className={cn(isUnread && 'border-primary/40')}
                title={t(copy.titleKey, copy.params)}
                subtitle={t(copy.bodyKey, copy.params)}
                meta={
                  <>
                    {notification.severity !== 'INFO' && (
                      <Badge
                        tone={notification.severity === 'CRITICAL' ? 'danger' : 'warning'}
                        size="sm"
                      >
                        {t(
                          notification.severity === 'CRITICAL'
                            ? 'status.severity.HIGH'
                            : 'status.severity.MEDIUM',
                        )}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {formatRelativeTime(notification.created_at)}
                    </span>
                  </>
                }
              />
            </li>
          );
        })}
      </ul>

      {unread.length > 0 && (
        <p className="px-1 text-xs text-muted-foreground">
          <Link to="/alerts" className="font-semibold text-primary hover:underline">
            {t('nav.alerts')}
          </Link>
        </p>
      )}
    </div>
  );
}
