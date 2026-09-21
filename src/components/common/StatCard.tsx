import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * A single number, plus what it means.
 *
 * Deliberately restrained: no sparklines, no percentage-change ribbons. The
 * manager dashboard shows five of these and each one has to be readable at a
 * glance, outdoors, held at arm's length.
 */
export function StatCard({
  label,
  value,
  sublabel,
  icon: Icon,
  tone = 'default',
  to,
  loading,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sublabel?: string;
  icon?: LucideIcon;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  to?: string;
  loading?: boolean;
  className?: string;
}) {
  const toneRing = {
    default: 'border-border',
    success: 'border-success/40',
    warning: 'border-warning/45',
    danger: 'border-destructive/45',
    info: 'border-info/40',
  }[tone];

  const toneIcon = {
    default: 'text-muted-foreground bg-muted',
    success: 'text-success bg-success-muted',
    warning: 'text-warning bg-warning-muted',
    danger: 'text-destructive bg-destructive-muted',
    info: 'text-info bg-info-muted',
  }[tone];

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug text-muted-foreground">{label}</p>
        {Icon && (
          <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg', toneIcon)}>
            <Icon className="size-4" aria-hidden />
          </span>
        )}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-16" />
      ) : (
        <p className="tabular mt-1.5 text-2xl font-bold leading-none">{value}</p>
      )}
      {sublabel && <p className="mt-1.5 text-xs text-muted-foreground">{sublabel}</p>}
    </>
  );

  const classes = cn(
    'block rounded-xl border bg-card p-4 text-left transition-colors',
    toneRing,
    to && 'hover:border-primary/50 active:bg-muted/40',
    className,
  );

  if (to && !loading) {
    return (
      <Link to={to} className={classes}>
        {body}
      </Link>
    );
  }
  return <div className={classes}>{body}</div>;
}
