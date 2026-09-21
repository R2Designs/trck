import { forwardRef } from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import * as SeparatorPrimitive from '@radix-ui/react-separator';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Toggle. 52×32 px, comfortably above the 44 px touch minimum in its row. */
export const Switch = forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(function Switch({ className, ...props }, ref) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        'peer inline-flex h-8 w-[3.25rem] shrink-0 cursor-pointer items-center rounded-full border-2',
        'border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2',
        'focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block size-6 rounded-full bg-background shadow-lg ring-0 transition-transform',
          'data-[state=checked]:translate-x-[1.375rem] data-[state=unchecked]:translate-x-0.5',
        )}
      />
    </SwitchPrimitive.Root>
  );
});

export const Checkbox = forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(function Checkbox({ className, ...props }, ref) {
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        'peer size-6 shrink-0 rounded-md border-2 border-input bg-background',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        <Check className="size-4" strokeWidth={3} aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});

export const Tabs = TabsPrimitive.Root;

export const TabsList = forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function TabsList({ className, ...props }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        // Horizontally scrollable on narrow screens: four translated tab
        // labels in Kannada will not fit 360 px, and wrapping them looks worse
        // than letting the row scroll.
        'flex w-full gap-1 overflow-x-auto rounded-lg bg-muted p-1 [scrollbar-width:none]',
        '[&::-webkit-scrollbar]:hidden',
        className,
      )}
      {...props}
    />
  );
});

export const TabsTrigger = forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        'inline-flex min-h-10 flex-1 shrink-0 items-center justify-center whitespace-nowrap rounded-md',
        'px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm',
        className,
      )}
      {...props}
    />
  );
});

export const TabsContent = forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Content
      ref={ref}
      className={cn('mt-4 focus-visible:outline-none', className)}
      {...props}
    />
  );
});

export const Progress = forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & {
    tone?: 'primary' | 'success' | 'warning';
  }
>(function Progress({ className, value, tone = 'primary', ...props }, ref) {
  const fill = tone === 'success' ? 'bg-success' : tone === 'warning' ? 'bg-warning' : 'bg-primary';
  return (
    <ProgressPrimitive.Root
      ref={ref}
      className={cn('relative h-2.5 w-full overflow-hidden rounded-full bg-muted', className)}
      value={value}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn('h-full w-full flex-1 transition-transform duration-300', fill)}
        style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
});

export const Separator = forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(function Separator({ className, orientation = 'horizontal', decorative = true, ...props }, ref) {
  return (
    <SeparatorPrimitive.Root
      ref={ref}
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  );
});

/**
 * Segmented control — used for short, mutually exclusive choices such as the
 * theme picker, where a dropdown would hide the options behind a tap.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; icon?: React.ReactNode }>;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('flex w-full gap-1 rounded-lg bg-muted p-1', className)}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-md px-2',
              'text-sm font-semibold transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.icon}
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
