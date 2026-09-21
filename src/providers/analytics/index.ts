import { config } from '@/app/config';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase/client';
import type { Json } from '@/lib/supabase/database.types';
import type {
  AnalyticsContext,
  AnalyticsEventMap,
  AnalyticsEventName,
  AnalyticsProvider,
} from './types';

/**
 * Analytics adapters.
 *
 * Three implementations, all free:
 *   • `supabase` — batched inserts into the project's own `analytics_events`
 *     table. No third party, no cost, and the data never leaves the tenant.
 *   • `console`  — development only.
 *   • `noop`     — tests, and any deployment that wants none of this.
 *
 * Events are buffered and flushed on an interval or on page hide, because a
 * manager on a weak connection should not pay a request per tap.
 */

let context: AnalyticsContext = {
  organizationId: null,
  depotId: null,
  userId: null,
  locale: null,
  appVersion: config.appVersion,
};

interface PendingEvent {
  name: string;
  properties: Record<string, unknown>;
  occurredAt: string;
}

const FLUSH_INTERVAL_MS = 15_000;
const MAX_BUFFER = 40;

class SupabaseAnalyticsProvider implements AnalyticsProvider {
  readonly name = 'supabase';
  private buffer: PendingEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  identify(next: AnalyticsContext): void {
    context = next;
    this.ensureTimer();
  }

  track<K extends AnalyticsEventName>(name: K, properties: AnalyticsEventMap[K]): void {
    // Events recorded before sign-in have nowhere to go: the table's RLS policy
    // requires the row's organisation to match the caller's. Dropping them is
    // correct, and better than queueing something that can never be inserted.
    if (!context.organizationId || !context.userId) return;

    this.buffer.push({
      name,
      properties: properties as Record<string, unknown>,
      occurredAt: new Date().toISOString(),
    });
    this.ensureTimer();
    if (this.buffer.length >= MAX_BUFFER) void this.flush();
  }

  private ensureTimer(): void {
    if (this.timer || typeof window === 'undefined') return;
    this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];

    const { error } = await supabase.from('analytics_events').insert(
      batch.map((event) => ({
        organization_id: context.organizationId,
        depot_id: context.depotId,
        user_id: context.userId,
        name: event.name,
        // The declared event map only ever holds primitives, so this is
        // JSON-safe by construction — but `Record<string, unknown>` cannot
        // prove that to the `Json` column type.
        properties: event.properties as Json,
        app_version: context.appVersion,
        locale: context.locale,
        occurred_at: event.occurredAt,
      })),
    );

    if (error) {
      // Analytics must never interrupt the product. A failed batch is dropped
      // rather than retried forever; the operational logs still record it.
      logger.debug('Analytics batch dropped', { count: batch.length, error });
    }
  }
}

class ConsoleAnalyticsProvider implements AnalyticsProvider {
  readonly name = 'console';
  identify(next: AnalyticsContext): void {
    context = next;
  }
  track<K extends AnalyticsEventName>(name: K, properties: AnalyticsEventMap[K]): void {
    logger.debug(`analytics: ${name}`, properties as Record<string, unknown>);
  }
  async flush(): Promise<void> {
    /* nothing buffered */
  }
}

class NoopAnalyticsProvider implements AnalyticsProvider {
  readonly name = 'noop';
  identify(): void {}
  track(): void {}
  async flush(): Promise<void> {}
}

let override: AnalyticsProvider | null = null;
let instance: AnalyticsProvider | null = null;

export function getAnalyticsProvider(): AnalyticsProvider {
  if (override) return override;
  if (!instance) {
    instance =
      config.analytics.provider === 'supabase'
        ? new SupabaseAnalyticsProvider()
        : config.analytics.provider === 'console'
          ? new ConsoleAnalyticsProvider()
          : new NoopAnalyticsProvider();
  }
  return instance;
}

export function __setAnalyticsProvider(provider: AnalyticsProvider | null): void {
  override = provider;
}

/** The single call site the rest of the application uses. */
export function trackEvent<K extends AnalyticsEventName>(
  name: K,
  properties: AnalyticsEventMap[K],
): void {
  try {
    getAnalyticsProvider().track(name, properties);
  } catch (error) {
    logger.debug('Analytics track failed', { name, error });
  }
}

export function identifyForAnalytics(next: AnalyticsContext): void {
  getAnalyticsProvider().identify(next);
}

if (typeof document !== 'undefined') {
  // `visibilitychange` rather than `beforeunload`: the latter is unreliable on
  // mobile, where a tab is usually frozen rather than unloaded.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void getAnalyticsProvider().flush();
  });
}

export * from './types';
