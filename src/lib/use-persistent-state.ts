"use client";

// State that survives leaving the screen. In the App Router a tab switch
// unmounts the page, so anything held in useState (a plan conversation, a draft)
// is lost on navigation. This is useState backed by localStorage: the value is
// restored on mount and written on every change, so a tab comes back exactly as
// it was left, across navigation, a refresh, and the PWA reloading after you
// switch apps. A timestamp expires stale state so a week-old draft does not
// resurrect, and clear() wipes it when the work is genuinely done.

import { useCallback, useEffect, useState } from "react";

const PREFIX = "mdt:persist:";
const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 hours

/** Remove every persisted key. Called on sign-out so state never leaks between accounts on a shared device. */
export function clearPersistedState(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => window.localStorage.removeItem(k));
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
  const [state, setState] = useState<T>(initial);
  // Gate writes until the first read has run, so the initial value never
  // clobbers a stored one before it is restored.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let value = initial;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as { v: T; t: number };
        if (parsed && typeof parsed.t === "number" && Date.now() - parsed.t < ttlMs) {
          value = parsed.v;
        } else {
          window.localStorage.removeItem(key);
        }
      }
    } catch {
      /* corrupt or unavailable */
    }
    setState(value);
    setHydrated(true);
    // Restore once per key; `initial` and `ttlMs` are treated as fixed for a key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(key, JSON.stringify({ v: state, t: Date.now() }));
    } catch {
      /* quota / private mode */
    }
  }, [key, state, hydrated]);

  const clear = useCallback(() => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    setState(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return [state, setState, clear] as const;
}
