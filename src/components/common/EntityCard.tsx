import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * The list row used everywhere instead of a table on mobile.
 *
 * A bus, a driver, a route and a trip all read the same way: an icon or
 * initials, a primary line, a supporting line, and a status on the right.
 * Keeping that consistent is what lets a manager scan a list without reading
 * the headers.
 */
export function EntityCard({
  title,
  subtitle,
  meta,
  icon: Icon,
  avatarText,
  trailing,
  to,
  onClick,
  className,
  highlight,
}: {
  title: string;
  subtitle?: string;
  meta?: React.ReactNode;
  icon?: LucideIcon;
  /** Initials shown when there is no photograph — never a face image in a list. */
  avatarText?: string;
  trailing?: React.ReactNode;
  to?: string;
  onClick?: () => void;
  className?: string;
  highlight?: boolean;
}) {
  const content = (
    <>
      {(Icon || avatarText) && (
        <span
          className={cn(
            'grid size-11 shrink-0 place-items-center rounded-lg text-sm font-bold',
            highlight ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
          )}
          aria-hidden
        >
          {Icon ? <Icon className="size-5" /> : avatarText}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.9375rem] font-semibold leading-snug">{title}</span>
        {subtitle && (
          <span className="mt-0.5 block truncate text-sm text-muted-foreground">{subtitle}</span>
        )}
        {meta && <span className="mt-1.5 flex flex-wrap items-center gap-1.5">{meta}</span>}
      </span>
      {trailing ? (
        <span className="flex shrink-0 items-center gap-1.5">{trailing}</span>
      ) : (
        (to || onClick) && (
          <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        )
      )}
    </>
  );

  const classes = cn(
    'flex w-full min-h-touch items-center gap-3 rounded-xl border border-border bg-card p-3 text-left',
    (to || onClick) && 'transition-colors hover:border-primary/40 active:bg-muted/50',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    className,
  );

  if (to) {
    return (
      <Link to={to} className={classes}>
        {content}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes}>
        {content}
      </button>
    );
  }
  return <div className={classes}>{content}</div>;
}

/** Two-letter initials from a person's name, for list avatars. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0] as string).slice(0, 2).toUpperCase();
  return `${(parts[0] as string)[0] ?? ''}${(parts.at(-1) as string)[0] ?? ''}`.toUpperCase();
}
