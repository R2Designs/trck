import { ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SectionHeading } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

export interface DashboardAction {
  to: string;
  label: string;
  icon: LucideIcon;
}

/** A shared, card-like action treatment for both operational home screens. */
export function DashboardActionStrip({
  title,
  actions,
}: {
  title: string;
  actions: readonly DashboardAction[];
}) {
  return (
    <section>
      <SectionHeading title={title} />
      <div
        className={cn(
          'mt-3 grid gap-3 sm:grid-cols-2 lg:gap-4',
          actions.length >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3',
        )}
      >
        {actions.map(({ to, label, icon: Icon }) => (
          <Button
            key={to}
            asChild
            variant="outline"
            size="lg"
            className="group min-h-16 justify-start gap-3 rounded-xl px-5 lg:min-h-20 lg:px-6"
          >
            <Link to={to}>
              <Icon className="size-5 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 flex-1 text-left text-base font-semibold leading-tight">
                {label}
              </span>
              <ChevronRight
                className="size-4 shrink-0 opacity-50 transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          </Button>
        ))}
      </div>
    </section>
  );
}
