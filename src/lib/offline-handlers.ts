import { supabase } from './supabase/client';
import { logger } from './logger';
import { registerQueueHandler } from './offline-queue';
import type { Insert, Update } from './supabase/database.types';

/**
 * Replay handlers for the offline write queue.
 *
 * A queued item without a registered handler is *dropped* on the next flush —
 * so this module existing, and being imported at start-up, is what makes the
 * queue real rather than a place writes go to die. It is imported for its side
 * effects from `src/main.tsx`.
 *
 * Every handler re-sends through the ordinary Supabase client, which means:
 *   • RLS still applies. A write that was not permitted when it was made is
 *     still not permitted when it is replayed — being offline is not a way
 *     around the policies.
 *   • The payload is exactly what the mutation would have sent. No handler
 *     re-derives `organization_id` or a timestamp, because a value computed at
 *     replay time would describe the wrong moment.
 *
 * Nothing biometric is here, and nothing can be added: `QueueableOperation` has
 * no attendance or face member. That is a deliberate limit, documented in
 * `offline-queue.ts`.
 */

/**
 * A replayed insert that has already succeeded once.
 *
 * A unique-violation on replay means the row is already there — usually
 * because the server committed the first attempt and the response never made
 * it back over a dying connection, or because another tab flushed the same
 * queue. Treating that as success is what stops a flaky depot connection from
 * producing duplicate buses.
 */
function isAlreadyApplied(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

/** The builder is thenable rather than a Promise, hence `PromiseLike`. */
type InsertResult = PromiseLike<{ error: { code?: string } | null }>;

async function replayInsert(run: () => InsertResult): Promise<void> {
  const { error } = await run();
  if (error && !isAlreadyApplied(error)) throw error;
}

let registered = false;

export function registerOfflineHandlers(): void {
  if (registered) return;
  registered = true;

  registerQueueHandler('bus.create', (payload) =>
    replayInsert(() => supabase.from('buses').insert(payload as Insert<'buses'>)),
  );
  registerQueueHandler('route.create', (payload) =>
    replayInsert(() => supabase.from('routes').insert(payload as Insert<'routes'>)),
  );
  registerQueueHandler('employee.create', (payload) =>
    replayInsert(() => supabase.from('employees').insert(payload as Insert<'employees'>)),
  );

  registerQueueHandler('bus.update', async (payload) => {
    const { id, ...values } = payload as { id: string } & Record<string, unknown>;
    // The payload was type-checked at the call site before it was queued; on
    // the way back out of IndexedDB it is structurally `unknown`, and the cast
    // is the boundary where that is acknowledged rather than hidden.
    const { error } = await supabase
      .from('buses')
      .update(values as Update<'buses'>)
      .eq('id', id);
    if (error) throw error;
  });

  registerQueueHandler('route.update', async (payload) => {
    const { id, ...values } = payload as { id: string } & Record<string, unknown>;
    // The payload was type-checked at the call site before it was queued; on
    // the way back out of IndexedDB it is structurally `unknown`, and the cast
    // is the boundary where that is acknowledged rather than hidden.
    const { error } = await supabase
      .from('routes')
      .update(values as Update<'routes'>)
      .eq('id', id);
    if (error) throw error;
  });

  registerQueueHandler('employee.update', async (payload) => {
    const { id, ...values } = payload as { id: string } & Record<string, unknown>;
    // The payload was type-checked at the call site before it was queued; on
    // the way back out of IndexedDB it is structurally `unknown`, and the cast
    // is the boundary where that is acknowledged rather than hidden.
    const { error } = await supabase
      .from('employees')
      .update(values as Update<'employees'>)
      .eq('id', id);
    if (error) throw error;
  });

  /**
   * A review is two writes: an immutable review row and the anomaly's status.
   * The review row goes first, so a failure between them leaves the anomaly
   * open with the reviewer's reasoning recorded — visible and re-reviewable —
   * rather than closed with no explanation.
   */
  registerQueueHandler('anomaly.review', async (payload) => {
    const item = payload as {
      review: Record<string, unknown>;
      anomalyId: string;
      newStatus: string;
      resolvedBy: string;
      resolvedAt: string;
    };

    await replayInsert(() =>
      supabase.from('anomaly_reviews').insert(item.review as Insert<'anomaly_reviews'>),
    );

    const { error } = await supabase
      .from('anomalies')
      .update({
        review_status: item.newStatus as Update<'anomalies'>['review_status'],
        resolved_at: item.resolvedAt,
        resolved_by: item.resolvedBy,
      })
      .eq('id', item.anomalyId);
    if (error) throw error;
  });

  registerQueueHandler('analytics.event', async (payload) => {
    const { error } = await supabase
      .from('analytics_events')
      .insert(payload as Insert<'analytics_events'>);
    // Analytics must never block the queue behind it: a rejected event is
    // discarded rather than retried, so a real write queued after it still
    // gets through.
    if (error) logger.debug('Queued analytics event discarded', { message: error.message });
  });
}
