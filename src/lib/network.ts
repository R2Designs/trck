/**
 * Connectivity state.
 *
 * `navigator.onLine` is necessary but not sufficient: an Android phone in a
 * depot yard is frequently "online" while attached to a cell that passes no
 * traffic. We therefore combine the browser flag with the outcome of real
 * requests, which the query client reports back into this module.
 */

import { useSyncExternalStore } from 'react';

export type ConnectionState = 'online' | 'offline' | 'unstable';

let browserOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
let consecutiveNetworkFailures = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function snapshot(): ConnectionState {
  if (!browserOnline) return 'offline';
  // Two failures in a row is enough to warn the user without being twitchy.
  if (consecutiveNetworkFailures >= 2) return 'unstable';
  return 'online';
}

let cached: ConnectionState = snapshot();

function refresh(): void {
  const next = snapshot();
  if (next !== cached) {
    cached = next;
    emit();
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    browserOnline = true;
    consecutiveNetworkFailures = 0;
    refresh();
  });
  window.addEventListener('offline', () => {
    browserOnline = false;
    refresh();
  });
}

/** Called by the query client when a request fails for network reasons. */
export function reportNetworkFailure(): void {
  consecutiveNetworkFailures += 1;
  refresh();
}

/** Called on any successful request. */
export function reportNetworkSuccess(): void {
  if (consecutiveNetworkFailures !== 0) {
    consecutiveNetworkFailures = 0;
    refresh();
  }
}

export function getConnectionState(): ConnectionState {
  return cached;
}

export function useConnectionState(): ConnectionState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => cached,
    () => 'online' as const,
  );
}

export function isOffline(): boolean {
  return cached === 'offline';
}

/** Exposed for tests, which need to drive this deterministically. */
export const __testing = {
  setBrowserOnline(value: boolean) {
    browserOnline = value;
    refresh();
  },
  reset() {
    browserOnline = true;
    consecutiveNetworkFailures = 0;
    cached = 'online';
  },
};
