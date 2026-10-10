"use client";

import { liveQuery } from "dexie";
import {
  type DependencyList,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

type LiveState<T> = { data: T | undefined; isLoading: boolean; error: boolean };

/**
 * Subscribes to an IndexedDB query and re-renders when the data changes,
 * including changes made by background parsing or another tab.
 */
export function useLiveQuery<T>(
  querier: () => Promise<T>,
  deps: DependencyList,
): LiveState<T> {
  const [state, setState] = useState<LiveState<T>>({
    data: undefined,
    isLoading: true,
    error: false,
  });

  useEffect(() => {
    const subscription = liveQuery(querier).subscribe({
      next: (data) => setState({ data, isLoading: false, error: false }),
      error: () =>
        setState((current) => ({ ...current, isLoading: false, error: true })),
    });

    return () => subscription.unsubscribe();
    // The caller owns the dependency list, as with useMemo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}

function subscribeOnline(callback: () => void): () => void {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);

  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

function subscribeViewport(callback: () => void): () => void {
  const viewport = window.visualViewport;

  viewport?.addEventListener("resize", callback);
  viewport?.addEventListener("scroll", callback);
  window.addEventListener("resize", callback);

  return () => {
    viewport?.removeEventListener("resize", callback);
    viewport?.removeEventListener("scroll", callback);
    window.removeEventListener("resize", callback);
  };
}

function readKeyboardInset(): number {
  const viewport = window.visualViewport;

  if (!viewport) {
    return 0;
  }

  const inset = window.innerHeight - viewport.height - viewport.offsetTop;

  // Ignore small differences from browser chrome showing and hiding.
  return inset > 120 ? Math.round(inset) : 0;
}

/** Height covered by an on-screen keyboard (0 when none is shown). */
export function useKeyboardInset(): number {
  return useSyncExternalStore(subscribeViewport, readKeyboardInset, () => 0);
}
