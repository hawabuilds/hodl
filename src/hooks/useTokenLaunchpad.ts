"use client";

import {useEffect, useSyncExternalStore} from "react";
import {normalizeAddress} from "@/lib/address";
import {rememberTokens, tokenFor} from "@/lib/tokenCache";
import type {Asset, Launchpad, TokenAsset} from "@/lib/types";

/**
 * The launchpad a token came from, for its picture's corner badge, where the
 * row only carries a symbol and an image — a holding, a followed trade.
 *
 * The token cache usually already knows it (any list or page that showed the
 * token filled it). The rest are batched: every lookup made in the same moment
 * goes out as one /api/assets request, so a feed of thirty trades is one call,
 * not thirty. Display only; nothing here touches balances.
 */

const found = new Map<string, Launchpad | null>();
const pending = new Set<string>();
const listeners = new Set<() => void>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let version = 0;

/** Most ids /api/assets takes in one request. */
const BATCH = 60;

function known(address: string): Launchpad | null | undefined {
  if (found.has(address)) return found.get(address);
  const cached = tokenFor(address);
  return cached ? (cached.launchpad ?? null) : undefined;
}

async function flush() {
  flushTimer = null;
  const wanted = [...pending];
  pending.clear();
  for (let i = 0; i < wanted.length; i += BATCH) {
    const slice = wanted.slice(i, i + BATCH);
    try {
      const ids = slice.map((address) => `token:${address}`).join(",");
      const res = await fetch(`/api/assets?ids=${encodeURIComponent(ids)}`);
      const assets = res.ok ? ((await res.json()) as {assets: Asset[]}).assets : [];
      const tokens = assets.filter((asset): asset is TokenAsset => asset.kind === "token");
      rememberTokens(tokens);
      for (const token of tokens) found.set(normalizeAddress(token.address), token.launchpad ?? null);
    } catch {
      // Unknown stays unknown: no badge, which is what an unknown launchpad shows anyway.
    }
    // Asked about and not answered is settled too, so it is not asked again.
    for (const address of slice) if (!found.has(address)) found.set(address, null);
  }
  version += 1;
  for (const listener of listeners) listener();
}

function request(address: string) {
  if (known(address) !== undefined || pending.has(address)) return;
  pending.add(address);
  flushTimer ??= setTimeout(() => void flush(), 30);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** `address` null (not a token) answers null. */
export function useTokenLaunchpad(address: string | null | undefined): Launchpad | null {
  const key = address ? normalizeAddress(address) : null;
  useSyncExternalStore(subscribe, () => version, () => 0);
  useEffect(() => {
    if (key) request(key);
  }, [key]);
  return key ? (known(key) ?? null) : null;
}
