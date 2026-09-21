import { cn } from '@/lib/cn';

/**
 * Surfaces. Borders are used rather than shadows as the primary separator —
 * shadows all but disappear on a cheap LCD in sunlight, a border does not.
 */
export function Card({
  className,
  interactive,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card text-card-foreground',
        interactive && 'transition-colors hover:border-primary/40 active:bg-muted/50',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 p-4 pb-2', className)} {...props} />;
}

export function CardTitle({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  // `children` is taken explicitly rather than spread: a heading with no
  // accessible content is invisible to a screen reader, and passing it through
  // props hides that mistake from both the reader and the linter.
  return (
    <h3 className={cn('text-base font-semibold leading-tight', className)} {...props}>
      {children}
    </h3>
  );
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4 pt-2', className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center gap-2 p-4 pt-0', className)} {...props} />;
}

/** Section heading used between cards on the dashboards. */
export function SectionHeading({
  title,
  action,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3 px-1', className)}>
      <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {action}
    </div>
  );
}
