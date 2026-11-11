import { initialState, reduceEvent, type PulseState } from './state.ts';

interface Entry { readonly event: unknown }
export interface EventWindow {
  readonly entries: readonly Entry[];
  readonly revision: number;
  readonly change: { readonly kind: string; readonly entries?: readonly Entry[] };
}
export interface EventSource {
  getSnapshot(): EventWindow;
  subscribe(listener: () => void): () => void;
}
/** Read DSH's already-authorized event feed. Never open another connection or
 * retain background sessions. A closed panel releases its only subscription. */
export function createMonitor(source: EventSource) {
  let state = initialState();
  let revision = -1;
  let unsubscribe: (() => void) | undefined;
  const listeners = new Set<() => void>();
  function refresh() {
    const window = source.getSnapshot();
    if (window.revision === revision) return;
    const incremental = revision >= 0 && window.revision === revision + 1 && window.change.kind === 'append';
    // Settlements remove transient frames; replay the authoritative window.
    // This also handles pagination, reconnect, and replacement without duplicates.
    let next = incremental ? state : initialState();
    for (const entry of incremental ? window.change.entries ?? [] : window.entries) next = reduceEvent(next, entry.event);
    revision = window.revision;
    if (state !== next) { state = next; for (const listener of listeners) listener(); }
  }
  refresh();
  return {
    getSnapshot: (): PulseState => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (!unsubscribe) { unsubscribe = source.subscribe(refresh); refresh(); }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) { unsubscribe?.(); unsubscribe = undefined; }
      };
    },
  };
}
