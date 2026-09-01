"use client";

import {useCallback, useEffect, useState} from "react";
import {LOCAL_STORE_EVENT} from "@/lib/localStore";

/**
 * Reads a value out of local storage and keeps it current.
 *
 * The initial value is deliberately the fallback rather than the stored one:
 * the server renders without storage, so reading it during the first render
 * would produce a hydration mismatch on every page that shows a watchlist star
 * or a balance. The real value lands in the effect, one frame later.
 *
 * Updates arrive from two directions — `LOCAL_STORE_EVENT` for writes in this
 * tab, and `storage` for writes in another one.
 */
export function useLocalStore<T>(read: () => T, fallback: T): [T, () => void] {
  const [value, setValue] = useState<T>(fallback);

  const refresh = useCallback(() => {
    setValue(read());
  }, [read]);

  useEffect(() => {
    refresh();
    window.addEventListener(LOCAL_STORE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(LOCAL_STORE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [refresh]);

  return [value, refresh];
}
