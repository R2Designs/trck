import { useTranslation } from 'react-i18next';
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Clock,
  Info,
  PauseCircle,
  Wrench,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import type {
  AnomalySeverity,
  AnomalyReviewStatus,
  BusStatus,
  ConfidenceBand,
  EmploymentStatus,
  TripStatus,
} from '@domain/types.ts';

/**
 * Status and severity chips.
 *
 * **Colour is never the only signal.** Every badge carries an icon and a
 * translated word as well, because a red dot means nothing to a colour-blind
 * manager, and nothing at all in bright sunlight where hue washes out.
 */

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground border-border',
  success: 'bg-success-muted text-success border-success/35',
  warning: 'bg-warning-muted text-warning border-warning/35',
  danger: 'bg-destructive-muted text-destructive border-destructive/35',
  info: 'bg-info-muted text-info border-info/35',
  primary: 'bg-primary-muted text-primary border-primary/35',
};

export function Badge({
  tone = 'neutral',
  icon: Icon,
  children,
  className,
  size = 'md',
}: {
  tone?: Tone;
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full border font-semibold',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {Icon && <Icon className="size-3.5 shrink-0" aria-hidden />}
      <span className="truncate">{children}</span>
    </span>
  );
}

const BUS_TONE: Record<BusStatus, { tone: Tone; icon: LucideIcon }> = {
  AVAILABLE: { tone: 'success', icon: CheckCircle2 },
  ON_TRIP: { tone: 'info', icon: CircleDot },
  MAINTENANCE: { tone: 'warning', icon: Wrench },
  OUT_OF_SERVICE: { tone: 'danger', icon: XCircle },
};

export function BusStatusBadge({ status, className }: { status: BusStatus; className?: string }) {
  const { t } = useTranslation();
  const { tone, icon } = BUS_TONE[status];
  return (
    <Badge tone={tone} icon={icon} className={className}>
      {t(`status.bus.${status}`)}
    </Badge>
  );
}

const TRIP_TONE: Record<TripStatus, { tone: Tone; icon: LucideIcon }> = {
  DRAFT: { tone: 'neutral', icon: PauseCircle },
  STARTED: { tone: 'info', icon: Clock },
  COMPLETED: { tone: 'success', icon: CheckCircle2 },
  REVIEW_REQUIRED: { tone: 'warning', icon: AlertTriangle },
  CANCELLED: { tone: 'neutral', icon: XCircle },
};

export function TripStatusBadge({ status, className }: { status: TripStatus; className?: string }) {
  const { t } = useTranslation();
  const { tone, icon } = TRIP_TONE[status];
  return (
    <Badge tone={tone} icon={icon} className={className}>
      {t(`status.trip.${status}`)}
    </Badge>
  );
}

export function EmploymentStatusBadge({ status }: { status: EmploymentStatus }) {
  const { t } = useTranslation();
  return (
    <Badge
      tone={status === 'ACTIVE' ? 'success' : 'neutral'}
      icon={status === 'ACTIVE' ? CheckCircle2 : PauseCircle}
      size="sm"
    >
      {t(`status.employment.${status}`)}
    </Badge>
  );
}

const SEVERITY_TONE: Record<AnomalySeverity, { tone: Tone; icon: LucideIcon }> = {
  HIGH: { tone: 'danger', icon: AlertOctagon },
  MEDIUM: { tone: 'warning', icon: AlertTriangle },
  LOW: { tone: 'info', icon: Info },
};

/**
 * Severity chip.
 *
 * Severity describes *distance from normal*, not culpability — the copy in
 * `anomalies.severityHint` says so explicitly next to every list of these.
 */
export function AnomalyBadge({
  severity,
  className,
  size = 'md',
}: {
  severity: AnomalySeverity;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const { t } = useTranslation();
  const { tone, icon } = SEVERITY_TONE[severity];
  return (
    <Badge tone={tone} icon={icon} className={className} size={size}>
      <span className="sr-only">
        {t('a11y.severityIcon', { severity: t(`status.severity.${severity}`) })}
      </span>
      <span aria-hidden>{t(`status.severity.${severity}`)}</span>
    </Badge>
  );
}

const REVIEW_TONE: Record<AnomalyReviewStatus, Tone> = {
  OPEN: 'warning',
  IN_REVIEW: 'info',
  REVIEWED_OK: 'success',
  NEEDS_INVESTIGATION: 'danger',
  FALSE_POSITIVE: 'neutral',
  READING_ERROR: 'neutral',
};

export function ReviewStatusBadge({ status }: { status: AnomalyReviewStatus }) {
  const { t } = useTranslation();
  return (
    <Badge tone={REVIEW_TONE[status]} size="sm">
      {t(`status.review.${status}`)}
    </Badge>
  );
}

const CONFIDENCE_TONE: Record<ConfidenceBand, { tone: Tone; icon: LucideIcon }> = {
  HIGH: { tone: 'success', icon: CheckCircle2 },
  MEDIUM: { tone: 'warning', icon: AlertTriangle },
  LOW: { tone: 'danger', icon: AlertOctagon },
};

/**
 * Confidence chip for an OCR or face-match result.
 * Always rendered next to the value it qualifies — a number without its
 * confidence is exactly the thing this product refuses to show.
 */
export function ConfidenceBadge({
  band,
  size = 'sm',
}: {
  band: ConfidenceBand;
  size?: 'sm' | 'md';
}) {
  const { t } = useTranslation();
  const { tone, icon } = CONFIDENCE_TONE[band];
  return (
    <Badge tone={tone} icon={icon} size={size}>
      {t(`status.confidence.${band}`)}
    </Badge>
  );
}
