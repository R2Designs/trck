import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AlertTriangle, Inbox, RefreshCw, SearchX, WifiOff } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { AppError } from '@/lib/errors';

/**
 * Empty, error and offline states.
 *
 * Every list, every detail screen and every wizard step in this product has
 * all three. They are components rather than ad-hoc markup so that "nothing
 * here yet" never renders as a blank rectangle the manager has to interpret.
 */

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  className,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-dashed border-border',
        'bg-card/50 px-6 py-10 text-center',
        className,
      )}
    >
      <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-6" aria-hidden />
      </span>
      <h3 className="mt-3 text-base font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function NoResultsState({ query, onClear }: { query?: string; onClear?: () => void }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={SearchX}
      title={t('empty.search')}
      description={query ? t('search.noResults', { query }) : t('empty.searchBody')}
      action={
        onClear ? (
          <Button variant="outline" onClick={onClear}>
            {t('actions.clearAll')}
          </Button>
        ) : undefined
      }
    />
  );
}

/**
 * Error state.
 *
 * Shows the *translated* message that `AppError` carries — never the technical
 * one. The technical detail is available behind a disclosure for support, and
 * only in non-production builds.
 */
export function ErrorState({
  error,
  onRetry,
  className,
  compact,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const appError = error instanceof AppError ? error : null;
  const messageKey = appError?.messageKey ?? 'errors.unknown';
  const offline = appError?.kind === 'OFFLINE';
  const retryable = appError?.retryable ?? true;

  return (
    <div
      role="alert"
      className={cn(
        'rounded-xl border-2 border-destructive/30 bg-destructive-muted text-foreground',
        compact ? 'p-3' : 'p-5',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-destructive">
          {offline ? (
            <WifiOff className="size-5" aria-hidden />
          ) : (
            <AlertTriangle className="size-5" aria-hidden />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t('errors.title')}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(messageKey, appError?.messageParams ?? {})}
          </p>
          {onRetry && retryable && (
            <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
              <RefreshCw className="size-4" aria-hidden />
              {t('actions.retry')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Full-page 404. */
export function NotFoundState() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <h1 className="text-xl font-bold">{t('errors.notFoundPageTitle')}</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">{t('errors.notFoundPageBody')}</p>
      <Button asChild className="mt-6">
        <Link to="/">{t('errors.goHome')}</Link>
      </Button>
    </div>
  );
}

/** Inline "you need a depot" state for a manager with no assignment yet. */
export function NoDepotState() {
  const { t } = useTranslation();
  return <EmptyState title={t('home.noDepotTitle')} description={t('home.noDepotBody')} />;
}
