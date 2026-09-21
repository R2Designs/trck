import { cn } from '@/lib/cn';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

/**
 * In-page heading.
 *
 * Distinct from the app bar: this is the screen's own title and its primary
 * action. On desktop they sit inline; on mobile they stack, so a long
 * translated heading never squeezes the button down to two characters.
 */
export function PageHeader({
  title,
  description,
  action,
  backTo,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  backTo?: string;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        'mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        {backTo && (
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="-ml-2 -mt-2 shrink-0"
            aria-label={t('actions.back')}
          >
            <Link to={backTo}>
              <ArrowLeft className="size-5" aria-hidden />
            </Link>
          </Button>
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-bold leading-tight tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Label/value pair used across every detail screen. */
export function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className={cn('min-w-0 text-right text-sm font-medium', mono && 'tabular')}>{value}</dd>
    </div>
  );
}

export function DetailList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <dl className={cn('divide-y divide-border', className)}>{children}</dl>;
}
