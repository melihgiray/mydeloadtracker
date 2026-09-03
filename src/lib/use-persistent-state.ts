"use client";

// State that survives leaving the screen. In the App Router a tab switch
// unmounts the page, so anything held in useState (a plan conversation, a draft)
// is lost on navigation. This is useState backed by localStorage: the value is
// restored on mount and written on every change, so a tab comes back exactly as
// it was left, across navigation, a refresh, and the PWA reloading after you
// switch apps. A timestamp expires stale state so a week-old draft does not
// resurrect, and clear() wipes it when the work is genuinely done.

import { useCallback, useRef, useSyncExternalStore } from "react";

const PREFIX = "mdt:persist:";
const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 hours
const listeners = new Map<string, Set<() => void>>();

type PersistedValue<T> = { v: T; t: number };

export function parsePersistedValue<T>(
  raw: string | null,
  initial: T,
  ttlMs: number,
  now: number = Date.now(),
): T {
  if (!raw) return initial;
  try {
    const parsed = JSON.parse(raw) as PersistedValue<T>;
    if (parsed && typeof parsed.t === "number" && now - parsed.t < ttlMs) return parsed.v;
  } catch {
    /* corrupt value */
  }
  return initial;
}

function emit(key: string) {
  listeners.get(key)?.forEach((listener) => listener());
}

function subscribe(key: string, listener: () => void) {
  let keyListeners = listeners.get(key);
  if (!keyListeners) {
    keyListeners = new Set();
    listeners.set(key, keyListeners);
  }
  keyListeners.add(listener);

  const handleStorage = (event: StorageEvent) => {
    if (event.key === key) listener();
  };
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener("storage", handleStorage);
    keyListeners.delete(listener);
    if (keyListeners.size === 0) listeners.delete(key);
  };
}

/** Remove every persisted key. Called on sign-out so state never leaks between accounts on a shared device. */
export function clearPersistedState(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => {
      window.localStorage.removeItem(k);
      emit(k);
    });
  } catch {
    /* private mode / no storage */
  }
}

export function usePersistentState<T>(
  name: string,
  initial: T,
  ttlMs: number = DEFAULT_TTL,
): readonly [T, (value: T | ((prev: T) => T)) => void, () => void] {
  const key = PREFIX + name;
  const initialRef = useRef(initial);
  const ttlRef = useRef(ttlMs);
  const rawRef = useRef<string | null | undefined>(undefined);
  const valueRef = useRef(initial);
  const volatileRef = useRef(false);

  const getSnapshot = useCallback(() => {
    if (volatileRef.current) return valueRef.current;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === rawRef.current) return valueRef.current;
      rawRef.current = raw;
      valueRef.current = parsePersistedValue(raw, initialRef.current, ttlRef.current);
    } catch {
      /* private mode / no storage: keep the in-memory value */
    }
    return valueRef.current;
  }, [key]);

  const getServerSnapshot = useCallback(() => initialRef.current, []);

  const subscribeToKey = useCallback((listener: () => void) => subscribe(key, listener), [key]);

  const state = useSyncExternalStore(subscribeToKey, getSnapshot, getServerSnapshot);

  const setState = useCallback(
    (next: T | ((prev: T) => T)) => {
      const value = next instanceof Function ? next(getSnapshot()) : next;
      const raw = JSON.stringify({ v: value, t: Date.now() } satisfies PersistedValue<T>);
      valueRef.current = value;
      rawRef.current = raw;
      try {
        window.localStorage.setItem(key, raw);
        volatileRef.current = false;
      } catch {
        volatileRef.current = true;
      }
      emit(key);
    },
    [getSnapshot, key],
  );

  const clear = useCallback(() => {
    valueRef.current = initialRef.current;
    rawRef.current = null;
    try {
      window.localStorage.removeItem(key);
      volatileRef.current = false;
    } catch {
      volatileRef.current = true;
    }
    emit(key);
  }, [key]);

  return [state, setState, clear] as const;
}
