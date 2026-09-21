/**
 * Locale-aware formatting.
 *
 * The rule this module exists to enforce: **format numbers and dates, never
 * content**. A date becomes "21 செப்., 2026" in Tamil; a driver's name,
 * a registration number and an employee ID stay exactly as they were entered,
 * in every language.
 *
 * Intl objects are cached because constructing one is surprisingly expensive
 * on the low-end Android devices this product targets.
 */

import { currentIntlLocale } from '@/i18n';

const numberFormatters = new Map<string, Intl.NumberFormat>();
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function numberFormatter(options: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  const locale = currentIntlLocale();
  const key = `${locale}:${JSON.stringify(options)}`;
  let formatter = numberFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    numberFormatters.set(key, formatter);
  }
  return formatter;
}

function dateFormatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const locale = currentIntlLocale();
  const key = `${locale}:${JSON.stringify(options)}`;
  let formatter = dateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    dateFormatters.set(key, formatter);
  }
  return formatter;
}

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** An em dash, used consistently wherever a value is genuinely unknown. */
export const EMPTY_VALUE = '—';

export function formatNumber(
  value: number | null | undefined,
  options: Intl.NumberFormatOptions = {},
): string {
  if (value == null || !Number.isFinite(value)) return EMPTY_VALUE;
  return numberFormatter(options).format(value);
}

export function formatDistance(km: number | null | undefined, decimals = 1): string {
  if (km == null || !Number.isFinite(km)) return EMPTY_VALUE;
  return formatNumber(km, { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

export function formatEfficiency(kmpl: number | null | undefined): string {
  if (kmpl == null || !Number.isFinite(kmpl)) return EMPTY_VALUE;
  return formatNumber(kmpl, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

export function formatPercent(
  value: number | null | undefined,
  { decimals = 1, signed = false }: { decimals?: number; signed?: boolean } = {},
): string {
  if (value == null || !Number.isFinite(value)) return EMPTY_VALUE;
  const formatted = formatNumber(value, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
    signDisplay: signed ? 'exceptZero' : 'auto',
  });
  return `${formatted}%`;
}

/** 0–1 confidence rendered as a whole percentage, which is how people read it. */
export function formatConfidence(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return EMPTY_VALUE;
  return formatPercent(Math.round(value * 100), { decimals: 0 });
}

export function formatDate(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return EMPTY_VALUE;
  return dateFormatter({ day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

export function formatLongDate(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return EMPTY_VALUE;
  return dateFormatter({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(
    date,
  );
}

export function formatTime(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return EMPTY_VALUE;
  return dateFormatter({ hour: 'numeric', minute: '2-digit' }).format(date);
}

export function formatDateTime(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return EMPTY_VALUE;
  return dateFormatter({
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

/** "2 hours ago" in the active language, via Intl.RelativeTimeFormat. */
export function formatRelativeTime(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return EMPTY_VALUE;

  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 60 * 60 * 24 * 365],
    ['month', 60 * 60 * 24 * 30],
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60],
    ['second', 1],
  ];

  const formatter = new Intl.RelativeTimeFormat(currentIntlLocale(), { numeric: 'auto' });
  for (const [unit, seconds] of units) {
    if (Math.abs(diffSeconds) >= seconds || unit === 'second') {
      return formatter.format(Math.round(diffSeconds / seconds), unit);
    }
  }
  return formatter.format(0, 'second');
}

/** Durations read better as "1 h 17 min" than as "77 minutes". */
export function formatDuration(minutes: number | null | undefined): {
  hours: number;
  minutes: number;
  totalMinutes: number;
} | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return null;
  const total = Math.round(minutes);
  return { hours: Math.floor(total / 60), minutes: total % 60, totalMinutes: total };
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return EMPTY_VALUE;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${formatNumber(bytes / 1024, { maximumFractionDigits: 0 })} KB`;
  return `${formatNumber(bytes / (1024 * 1024), { maximumFractionDigits: 1 })} MB`;
}

/**
 * Registration numbers are displayed exactly as stored — spacing included.
 * This helper exists only so that the intent is explicit at call sites and
 * nobody is tempted to "tidy" them.
 */
export function formatRegistration(registration: string): string {
  return registration;
}

/** Which greeting to use, based on the viewer's own clock. */
export function greetingKey(date = new Date()): 'Morning' | 'Afternoon' | 'Evening' {
  const hour = date.getHours();
  if (hour < 12) return 'Morning';
  if (hour < 17) return 'Afternoon';
  return 'Evening';
}
