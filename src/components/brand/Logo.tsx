import { cn } from '@/lib/cn';

/**
 * The trck mark — a map pin with a ground shadow: "a vehicle, located".
 *
 * Inline SVG rather than an image file, so it stays crisp at every density,
 * follows the current theme, and costs no extra request on a weak connection.
 * The hole is cut with `fill-rule="evenodd"` instead of a mask, because masks
 * render inconsistently in older Android WebViews.
 *
 * `tone`:
 *   "brand" — filled badge, for the sign-in screen and the app bar
 *   "mono"  — inherits `currentColor`, for dense lists and disabled states
 */
export function LogoMark({
  className,
  tone = 'brand',
  title,
}: {
  className?: string;
  tone?: 'brand' | 'mono';
  title?: string;
}) {
  const gradientId = tone === 'brand' ? 'trck-badge' : undefined;
  const badgeFill = tone === 'brand' ? `url(#${gradientId})` : 'currentColor';
  const pinFill = tone === 'brand' ? '#FFFFFF' : 'hsl(var(--background))';

  return (
    <svg
      viewBox="0 0 48 48"
      className={cn('h-9 w-9 shrink-0', className)}
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {tone === 'brand' && (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#12654A" />
            <stop offset="100%" stopColor="#0A3A2B" />
          </linearGradient>
        </defs>
      )}
      <rect x="0" y="0" width="48" height="48" rx="13" fill={badgeFill} />
      <ellipse cx="24" cy="41.4" rx="6.2" ry="1.7" fill={pinFill} opacity="0.42" />
      <path
        fillRule="evenodd"
        fill={pinFill}
        d="M24 39.2c0 0 11.2-10.6 11.2-19.9a11.2 11.2 0 1 0-22.4 0c0 9.3 11.2 19.9 11.2 19.9Z
           M24 14.4a4.6 4.6 0 1 0 0 9.2 4.6 4.6 0 0 0 0-9.2Z"
      />
    </svg>
  );
}

/**
 * Mark plus wordmark.
 *
 * "trck" is a proper noun, so it is never translated and never localised. This
 * is the one place in the application where a user-visible string is written
 * literally rather than resolved through i18n — deliberately, and only here.
 */
export function Logo({
  className,
  markClassName,
  tone = 'brand',
  showWordmark = true,
  subtitle,
}: {
  className?: string;
  markClassName?: string;
  tone?: 'brand' | 'mono';
  showWordmark?: boolean;
  subtitle?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark tone={tone} className={markClassName} title="trck" />
      {showWordmark && (
        <span className="flex min-w-0 flex-col leading-none">
          <span className="text-[1.375rem] font-bold tracking-tight text-foreground">trck</span>
          {subtitle && (
            <span className="mt-1 truncate text-xs font-medium text-muted-foreground">
              {subtitle}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
