"use client";

import {useCallback, useSyncExternalStore} from "react";
import {priceFor, subscribe} from "@/lib/livePrice";

/**
 * The canonical price for one asset, or null until something publishes one.
 *
 * Backed by the shared store rather than a query cache: the feed publishes
 * several hundred prices every ten seconds, and holding each of those as its
 * own cache entry would cost far more than the one number it carries.
 */
export function useLivePrice(id: string): number | null {
  const read = useCallback(() => priceFor(id), [id]);
  // The server render has no live price and must not invent one, so the
  // server snapshot is null and the first client paint matches it.
  return useSyncExternalStore(subscribe, read, () => null);
}
