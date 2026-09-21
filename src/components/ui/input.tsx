import { forwardRef, useId } from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Form primitives.
 *
 * Two mobile-specific choices worth noting:
 *   • Inputs are 48 px tall and use a 16 px font. Anything smaller makes iOS
 *     Safari zoom on focus, which then leaves the field half off-screen.
 *   • `inputMode` is set explicitly wherever a numeric keypad is wanted —
 *     `type="number"` alone gives an inconsistent keyboard across Android
 *     builds and silently rejects locale decimal separators.
 */

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'flex h-12 w-full rounded-lg border-2 border-input bg-background px-3.5 text-base',
        'text-foreground placeholder:text-muted-foreground/80',
        'focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25',
        'disabled:cursor-not-allowed disabled:opacity-60',
        'aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive/20',
        className,
      )}
      {...props}
    />
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function Textarea({ className, invalid, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'flex min-h-[6.5rem] w-full rounded-lg border-2 border-input bg-background px-3.5 py-3 text-base',
        'placeholder:text-muted-foreground/80 focus-visible:outline-none focus-visible:border-ring',
        'focus-visible:ring-2 focus-visible:ring-ring/25 disabled:opacity-60',
        'aria-[invalid=true]:border-destructive',
        className,
      )}
      {...props}
    />
  );
});

export function Label({
  className,
  required,
  requiredLabel,
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement> & {
  required?: boolean;
  /** Translated word for "required", announced to screen readers. */
  requiredLabel?: string;
}) {
  return (
    <label className={cn('block text-sm font-semibold text-foreground', className)} {...props}>
      {children}
      {required && (
        <>
          <span aria-hidden className="ml-0.5 text-destructive">
            *
          </span>
          {requiredLabel && <span className="sr-only"> ({requiredLabel})</span>}
        </>
      )}
    </label>
  );
}

export function FieldHint({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn('text-sm text-muted-foreground', className)} {...props}>
      {children}
    </p>
  );
}

export function FieldError({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className={cn('flex items-start gap-1.5 text-sm font-medium text-destructive', className)}
      {...props}
    >
      {/* Never colour alone: the icon carries the same meaning. */}
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/**
 * Label + control + hint + error, wired together with the right `aria-*`
 * relationships so a screen reader announces the hint and the error with the
 * field rather than as orphaned text.
 */
export function Field({
  label,
  hint,
  error,
  required,
  requiredLabel,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  requiredLabel?: string;
  children: (props: {
    id: string;
    'aria-describedby': string | undefined;
    'aria-invalid': boolean | undefined;
  }) => React.ReactNode;
  className?: string;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id} required={required} requiredLabel={requiredLabel}>
        {label}
      </Label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint && !error && <FieldHint id={hintId}>{hint}</FieldHint>}
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  );
}
