import type { NotificationKind, NotificationSeverity } from '@domain/types.ts';
import { supabase } from '@/lib/supabase/client';
import { logger } from '@/lib/logger';

/**
 * Notification delivery.
 *
 * V1 delivers in-app only, and that is a cost decision rather than a design
 * one: SMS and WhatsApp both bill per message, and the brief was to reach zero
 * running cost. The interface below is the seam that makes adding a channel a
 * new adapter rather than a rewrite — `dispatch()` takes translation *keys*
 * and parameters, never a rendered sentence, precisely so an SMS adapter can
 * render them in the recipient's own language later.
 *
 * Nothing here is a security boundary: the `notifications` table's RLS policy
 * decides who can read a row, whoever wrote it.
 */

export interface NotificationRequest {
  organizationId: string;
  depotId?: string | null;
  /** Exactly one of these targets a notification. */
  recipientId?: string | null;
  recipientRole?: 'ADMIN' | 'MANAGER' | null;
  kind: NotificationKind;
  severity?: NotificationSeverity;
  titleKey: string;
  bodyKey: string;
  params?: Record<string, unknown>;
  entityType?: string;
  entityId?: string;
  expiresAt?: string;
}

export interface NotificationProvider {
  readonly name: string;
  readonly channel: 'in-app' | 'email' | 'sms' | 'push';
  dispatch(request: NotificationRequest): Promise<void>;
}

class InAppNotificationProvider implements NotificationProvider {
  readonly name = 'in-app';
  readonly channel = 'in-app' as const;

  async dispatch(request: NotificationRequest): Promise<void> {
    const { error } = await supabase.from('notifications').insert({
      organization_id: request.organizationId,
      depot_id: request.depotId ?? null,
      recipient_id: request.recipientId ?? null,
      recipient_role: request.recipientRole ?? null,
      kind: request.kind,
      severity: request.severity ?? 'INFO',
      title_key: request.titleKey,
      body_key: request.bodyKey,
      payload: (request.params ?? {}) as never,
      entity_type: request.entityType ?? null,
      entity_id: request.entityId ?? null,
      expires_at: request.expiresAt ?? null,
    });

    if (error) {
      // A missed notification must never fail the operation that produced it —
      // the trip is still completed, the anomaly still recorded.
      logger.warn('Notification could not be delivered', { kind: request.kind, error });
    }
  }
}

/** Fans one request out to every configured channel. */
class CompositeNotificationProvider implements NotificationProvider {
  readonly name = 'composite';
  readonly channel = 'in-app' as const;

  constructor(private readonly providers: readonly NotificationProvider[]) {}

  async dispatch(request: NotificationRequest): Promise<void> {
    await Promise.allSettled(this.providers.map((provider) => provider.dispatch(request)));
  }
}

const inAppProvider = new InAppNotificationProvider();
let override: NotificationProvider | null = null;

export function getNotificationProvider(): NotificationProvider {
  return override ?? inAppProvider;
}

export function __setNotificationProvider(provider: NotificationProvider | null): void {
  override = provider;
}

export function composeNotificationProviders(
  ...providers: NotificationProvider[]
): NotificationProvider {
  return new CompositeNotificationProvider(providers);
}

export async function notify(request: NotificationRequest): Promise<void> {
  await getNotificationProvider().dispatch(request);
}
