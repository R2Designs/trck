/**
 * Offline write queue.
 *
 * Scope, chosen deliberately:
 *
 *   • **Queued:** low-risk writes whose meaning does not change with time —
 *     creating a driver, editing a bus, resolving an alert, recording an
 *     analytics event.
 *   • **Never queued:** anything biometric. A face scan cannot be verified
 *     without the candidate descriptors, and caching a driver's face image in
 *     browser storage to replay later would be both a privacy hazard and a
 *     lie about what happened. Attendance taken with no signal uses the
 *     explicit manual-entry path instead, which the manager knowingly chooses.
 *
 * Items live in IndexedDB so they survive a tab crash or a phone reboot, and
 * they are replayed oldest-first once connectivity returns.
 */

import { logger } from './logger';

const DB_NAME = 'trck-offline';
const DB_VERSION = 1;
const STORE = 'pending-writes';

export type QueueableOperation =
  | 'employee.create'
  | 'employee.update'
  | 'bus.create'
  | 'bus.update'
  | 'route.create'
  | 'route.update'
  | 'anomaly.review'
  | 'analytics.event';

export interface QueuedItem<TPayload = unknown> {
  id: string;
  operation: QueueableOperation;
  payload: TPayload;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

type Handler = (payload: unknown) => Promise<void>;

const handlers = new Map<QueueableOperation, Handler>();
const listeners = new Set<(count: number) => void>();
let cachedCount = 0;

export function registerQueueHandler(operation: QueueableOperation, handler: Handler): void {
  handlers.set(operation, handler);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = fn(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function notify(): Promise<void> {
  cachedCount = await pendingCount();
  for (const listener of listeners) listener(cachedCount);
}

export function subscribeToQueue(listener: (count: number) => void): () => void {
  listeners.add(listener);
  listener(cachedCount);
  return () => listeners.delete(listener);
}

export async function pendingCount(): Promise<number> {
  try {
    return await withStore('readonly', (store) => store.count());
  } catch {
    // No IndexedDB (private mode, ancient WebView): the queue simply does not
    // exist, and callers fall back to failing the write loudly.
    return 0;
  }
}

export async function enqueue<TPayload>(
  operation: QueueableOperation,
  payload: TPayload,
): Promise<QueuedItem<TPayload>> {
  const item: QueuedItem<TPayload> = {
    id: crypto.randomUUID(),
    operation,
    payload,
    createdAt: Date.now(),
    attempts: 0,
  };
  await withStore('readwrite', (store) => store.add(item));
  logger.info('Queued offline write', { operation, id: item.id });
  await notify();
  return item;
}

async function allItems(): Promise<QueuedItem[]> {
  const items = await withStore<QueuedItem[]>(
    'readonly',
    (store) => store.getAll() as IDBRequest<QueuedItem[]>,
  );
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

let flushing = false;

/**
 * Replays every queued write. Safe to call repeatedly and concurrently; the
 * second caller returns immediately rather than double-sending.
 */
export async function flushQueue(): Promise<{ sent: number; failed: number }> {
  if (flushing) return { sent: 0, failed: 0 };
  flushing = true;
  let sent = 0;
  let failed = 0;

  try {
    for (const item of await allItems()) {
      const handler = handlers.get(item.operation);
      if (!handler) {
        logger.warn('No handler for queued operation; dropping', { operation: item.operation });
        await withStore('readwrite', (store) => store.delete(item.id));
        continue;
      }

      try {
        await handler(item.payload);
        await withStore('readwrite', (store) => store.delete(item.id));
        sent += 1;
      } catch (error) {
        failed += 1;
        const attempts = item.attempts + 1;
        const message = error instanceof Error ? error.message : String(error);

        // Give up after five attempts rather than retrying forever — but keep
        // the item so the operator can see it was never delivered.
        if (attempts >= 5) {
          logger.error('Queued write abandoned after repeated failures', {
            operation: item.operation,
            id: item.id,
            attempts,
            message,
          });
        }
        await withStore('readwrite', (store) =>
          store.put({ ...item, attempts, lastError: message }),
        );
        break; // stop on first failure: order matters and the network is likely down
      }
    }
  } finally {
    flushing = false;
    await notify();
  }

  return { sent, failed };
}

export async function clearQueue(): Promise<void> {
  await withStore('readwrite', (store) => store.clear());
  await notify();
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void flushQueue();
  });
  void notify();
}
