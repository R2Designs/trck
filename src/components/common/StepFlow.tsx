import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * The conversational step pattern.
 *
 * Every core journey in this product — taking attendance, starting a trip,
 * ending one, enrolling a face — is a sequence of single questions asked in
 * plain language: "Which route is this for?", then "Which bus are they
 * driving?", then "Now let's check who's driving".
 *
 * The reason is not stylistic. A manager runs these flows standing beside a
 * bus, one-handed, often in sunlight, frequently interrupted. A dense form
 * demands that they hold the whole task in their head; one question at a time
 * does not. It also means each answer can narrow the next question — choosing
 * a route filters the buses, choosing a bus surfaces the scheduled driver.
 *
 * Answered steps collapse into a compact summary line that stays tappable, so
 * going back to change an answer costs one tap rather than a restart.
 */

export interface StepHeaderProps {
  /** 1-based. */
  current: number;
  total: number;
  /** The question, phrased as a question. */
  prompt: string;
  /** One clarifying sentence, when the question needs it. */
  hint?: string;
}

export function StepHeader({ current, total, prompt, hint }: StepHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className="mb-4">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
        {t('a11y.progressStep', { current, total })}
      </p>
      <h2 className="mt-1.5 text-xl font-bold leading-snug tracking-tight">{prompt}</h2>
      {hint && <p className="mt-1.5 text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Slim progress rail above the current question. */
export function StepProgress({ current, total }: { current: number; total: number }) {
  const { t } = useTranslation();
  return (
    <div
      className="mb-4 flex gap-1.5"
      role="progressbar"
      aria-valuenow={current}
      aria-valuemin={1}
      aria-valuemax={total}
      aria-label={t('a11y.progressStep', { current, total })}
    >
      {Array.from({ length: total }).map((_, index) => (
        <span
          key={index}
          className={cn(
            'h-1.5 flex-1 rounded-full transition-colors',
            index < current ? 'bg-primary' : 'bg-muted',
          )}
        />
      ))}
    </div>
  );
}

/**
 * A collapsed, answered step.
 *
 * Reads back as a statement rather than a form field — "Route · Majestic →
 * Electronic City" — so the manager can see the shape of what they have told
 * us so far without re-reading the questions.
 */
export function AnsweredStep({
  label,
  value,
  onEdit,
}: {
  label: string;
  value: string;
  onEdit?: () => void;
}) {
  const { t } = useTranslation();

  const content = (
    <>
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-success text-success-foreground">
        <Check className="size-3.5" strokeWidth={3} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-muted-foreground">{label}</span>
        <span className="block truncate text-sm font-semibold">{value}</span>
      </span>
      {onEdit && (
        <span className="shrink-0 text-xs font-semibold text-primary">{t('actions.edit')}</span>
      )}
    </>
  );

  const classes =
    'flex w-full min-h-touch items-center gap-2.5 rounded-lg border border-border bg-muted/40 px-3 py-2 text-left';

  return onEdit ? (
    <button type="button" onClick={onEdit} className={cn(classes, 'hover:bg-muted')}>
      {content}
    </button>
  ) : (
    <div className={classes}>{content}</div>
  );
}

/** A list of choices rendered as large, tappable cards — the default input. */
export function ChoiceList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <ul className={cn('space-y-2.5', className)}>{children}</ul>;
}

export function Choice({
  title,
  subtitle,
  meta,
  selected,
  onSelect,
  disabled,
  disabledReason,
}: {
  title: string;
  subtitle?: string;
  meta?: React.ReactNode;
  selected?: boolean;
  onSelect: () => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        aria-current={selected ? 'true' : undefined}
        className={cn(
          'flex w-full min-h-touch-lg items-center gap-3 rounded-xl border-2 px-4 py-3 text-left',
          'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          selected
            ? 'border-primary bg-primary-muted'
            : 'border-border bg-card hover:border-primary/40',
          disabled && 'cursor-not-allowed opacity-55',
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-semibold">{title}</span>
          {subtitle && (
            <span className="mt-0.5 block truncate text-sm text-muted-foreground">{subtitle}</span>
          )}
          {disabled && disabledReason && (
            <span className="mt-1 block text-xs font-medium text-muted-foreground">
              {disabledReason}
            </span>
          )}
        </span>
        {meta && <span className="flex shrink-0 items-center gap-1.5">{meta}</span>}
        {selected && <Check className="size-5 shrink-0 text-primary" aria-hidden />}
      </button>
    </li>
  );
}

/**
 * The closing beat of a flow: what just happened, stated as a fact.
 *
 * "Ramesh Kumar is marked present · Recorded at 7:42 AM on KA 01 AB 1234,
 * Majestic → Electronic City". Not a toast — the manager needs to be able to
 * read it back to the driver standing in front of them.
 */
export function FlowSuccess({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <span className="grid size-16 place-items-center rounded-full bg-success text-success-foreground">
        {icon ?? <Check className="size-8" strokeWidth={2.5} aria-hidden />}
      </span>
      <h2 className="mt-4 text-xl font-bold leading-snug">{title}</h2>
      {description && <p className="mt-2 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {children && <div className="mt-6 w-full">{children}</div>}
    </div>
  );
}
