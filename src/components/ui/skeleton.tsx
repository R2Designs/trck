import { cn } from '@/lib/cn';

/**
 * Loading placeholders.
 *
 * Skeletons mirror the shape of the content they replace so the layout does
 * not jump when data lands — on a slow connection that jump is the difference
 * between a manager tapping the button they meant to and tapping the one that
 * slid into its place.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('skeleton', className)} aria-hidden {...props} />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton key={index} className={cn('h-4', index === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-xl border border-border bg-card p-4', className)} aria-hidden>
      <div className="flex items-start gap-3">
        <Skeleton className="size-11 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      </div>
    </div>
  );
}

export function SkeletonList({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)} role="status" aria-live="polite">
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonCard key={index} />
      ))}
    </div>
  );
}

export function SkeletonStatGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3" aria-hidden>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-xl border border-border bg-card p-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-7 w-14" />
        </div>
      ))}
    </div>
  );
}
