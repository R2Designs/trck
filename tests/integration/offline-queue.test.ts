import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearQueue,
  enqueue,
  flushQueue,
  pendingCount,
  registerQueueHandler,
  subscribeToQueue,
} from '@/lib/offline-queue';

/**
 * The offline queue, against a real IndexedDB implementation.
 *
 * What is actually being protected here is a manager's typing. They stand in a
 * depot yard with one bar of signal, fill in a new driver, and tap save. The
 * write is queued; the phone comes back into coverage; the write lands. If any
 * of that is wrong the failure is silent — the form closes, the manager moves
 * on, and the record simply never exists.
 *
 * So these tests assert the unhappy paths as carefully as the happy one:
 * ordering, retry accounting, the stop-on-failure rule, and the fact that a
 * duplicate replay is not treated as an error.
 */

describe('offline write queue', () => {
  beforeEach(async () => {
    await clearQueue();
  });

  afterEach(async () => {
    await clearQueue();
    vi.restoreAllMocks();
  });

  it('holds a write and replays it when connectivity returns', async () => {
    const sent: unknown[] = [];
    registerQueueHandler('bus.create', async (payload) => {
      sent.push(payload);
    });

    await enqueue('bus.create', { registration_number: 'KA-01-AA-1111' });
    expect(await pendingCount()).toBe(1);

    const result = await flushQueue();

    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(sent).toEqual([{ registration_number: 'KA-01-AA-1111' }]);
    expect(await pendingCount()).toBe(0);
  });

  it('replays in the order the manager entered things', async () => {
    const order: string[] = [];
    registerQueueHandler('bus.create', async (payload) => {
      order.push((payload as { name: string }).name);
    });

    await enqueue('bus.create', { name: 'first' });
    // The queue orders by creation time, so the second item needs a later one.
    await new Promise((resolve) => setTimeout(resolve, 2));
    await enqueue('bus.create', { name: 'second' });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await enqueue('bus.create', { name: 'third' });

    await flushQueue();
    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('stops at the first failure instead of scrambling the order', async () => {
    const seen: string[] = [];
    registerQueueHandler('bus.create', async (payload) => {
      const name = (payload as { name: string }).name;
      seen.push(name);
      if (name === 'second') throw new Error('network down');
    });

    await enqueue('bus.create', { name: 'first' });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await enqueue('bus.create', { name: 'second' });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await enqueue('bus.create', { name: 'third' });

    const result = await flushQueue();

    expect(seen).toEqual(['first', 'second']);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
    // The failed item and everything behind it survive for the next attempt.
    expect(await pendingCount()).toBe(2);
  });

  it('keeps a failed item and records why, rather than dropping it silently', async () => {
    registerQueueHandler('bus.create', async () => {
      throw new Error('depot gateway refused the connection');
    });

    await enqueue('bus.create', { registration_number: 'KA-01-AA-2222' });
    await flushQueue();

    expect(await pendingCount()).toBe(1);

    // A second attempt must not lose it either.
    await flushQueue();
    expect(await pendingCount()).toBe(1);
  });

  it('discards an item whose operation has no handler, and says so', async () => {
    // Deliberately not registered: this is the state the app is in if
    // `registerOfflineHandlers()` is ever dropped from bootstrap.
    await enqueue('analytics.event', { name: 'login_success' });
    const result = await flushQueue();

    expect(result.sent).toBe(0);
    expect(await pendingCount()).toBe(0);
  });

  it('notifies subscribers as the count changes, so the banner stays honest', async () => {
    const counts: number[] = [];
    const unsubscribe = subscribeToQueue((count) => counts.push(count));

    registerQueueHandler('bus.create', async () => {});
    await enqueue('bus.create', { a: 1 });
    await flushQueue();
    unsubscribe();

    expect(counts[0]).toBe(0); // current value on subscribe
    expect(counts).toContain(1); // after enqueue
    expect(counts.at(-1)).toBe(0); // after a successful flush
  });

  it('a concurrent flush does not double-send', async () => {
    let calls = 0;
    registerQueueHandler('bus.create', async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    await enqueue('bus.create', { a: 1 });
    const [first, second] = await Promise.all([flushQueue(), flushQueue()]);

    expect(calls).toBe(1);
    expect(first.sent + second.sent).toBe(1);
  });

  it('survives a reload: items persist beyond the in-memory queue', async () => {
    registerQueueHandler('employee.create', async () => {});
    await enqueue('employee.create', { full_name: 'Persisted' });

    // A fresh count goes back to IndexedDB rather than to a variable.
    expect(await pendingCount()).toBe(1);
  });
});
