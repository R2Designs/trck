import { forwardRef } from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Select, built on Radix so keyboard and screen-reader behaviour is correct
 * without re-implementing a listbox. The trigger matches `Input` exactly —
 * a form where the dropdown is a different height from the text field looks
 * broken long before anyone can say why.
 */
export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> & { invalid?: boolean }
>(function SelectTrigger({ className, children, invalid, ...props }, ref) {
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'flex h-12 w-full items-center justify-between gap-2 rounded-lg border-2 border-input',
        'bg-background px-3.5 text-base text-foreground',
        'data-[placeholder]:text-muted-foreground/80',
        'focus:outline-none focus:border-ring focus:ring-2 focus:ring-ring/25',
        'disabled:cursor-not-allowed disabled:opacity-60',
        'aria-[invalid=true]:border-destructive',
        '[&>span]:truncate [&>span]:text-left',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-5 shrink-0 opacity-60" aria-hidden />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
});

export const SelectContent = forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(function SelectContent({ className, children, position = 'popper', ...props }, ref) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        position={position}
        className={cn(
          'relative z-50 max-h-[min(24rem,60vh)] min-w-[8rem] overflow-hidden rounded-lg border',
          'border-border bg-popover text-popover-foreground shadow-lg animate-fade-in',
          position === 'popper' && 'w-[var(--radix-select-trigger-width)]',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.ScrollUpButton className="flex h-7 items-center justify-center">
          <ChevronUp className="size-4" aria-hidden />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="flex h-7 items-center justify-center">
          <ChevronDown className="size-4" aria-hidden />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
});

export const SelectItem = forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item> & { description?: string }
>(function SelectItem({ className, children, description, ...props }, ref) {
  return (
    <SelectPrimitive.Item
      ref={ref}
      className={cn(
        'relative flex min-h-touch w-full cursor-pointer select-none items-center gap-2 rounded-md',
        'py-2.5 pl-3 pr-9 text-base outline-none',
        'focus:bg-primary-muted focus:text-foreground data-[state=checked]:font-semibold',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="flex min-w-0 flex-col">
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        {description && (
          <span className="truncate text-xs font-normal text-muted-foreground">{description}</span>
        )}
      </span>
      <span className="absolute right-3 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-4 text-primary" aria-hidden />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  );
});

export const SelectLabel = forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(function SelectLabel({ className, ...props }, ref) {
  return (
    <SelectPrimitive.Label
      ref={ref}
      className={cn(
        'px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
});

export const SelectSeparator = forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(function SelectSeparator({ className, ...props }, ref) {
  return (
    <SelectPrimitive.Separator
      ref={ref}
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  );
});
