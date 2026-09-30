"use client";

import {useEffect, useState} from "react";
import {useQueryClient, type QueryClient} from "@tanstack/react-query";

import {acceptMarket, marketQueryKey, type MarketResponse} from "@/hooks/useMarket";
import {acceptNewTokensPage, type NewTokensPage} from "@/hooks/useNewTokens";
import {newsFeedQuery} from "@/hooks/useNewsFeed";
import type {NewsTopic, NewsWindow} from "@/lib/types";

/**
 * Desktop Home in one request. `/api/home` returns what the cards would each
 * have fetched; this puts every answer into the cache the card reads, so the
 * whole page appears together instead of card by card.
 *
 * `ready` turns true when the bundle has landed, or after MAX_WAIT_MS if it
 * has not — a slow bundle must not hold the page, and any card it did not
 * fill fetches for itself.
 */
const MAX_WAIT_MS = 1_500;

/** The same key `useNewTokens({}, …)` reads for Home's "Just launched". */
const NEW_TOKENS_KEY = ["tokens-new", {}] as const;

interface HomeBundle {
  market: {trending: MarketResponse | null; volume: MarketResponse | null};
  newTokens: NewTokensPage | null;
  news: {window: string; topic: string; body: unknown} | null;
  chart: {id: string; timeframe: string; body: unknown} | null;
}

let loadedOnce = false;
let inFlight: Promise<void> | null = null;

/**
 * Fetch the bundle and fill every card's cache. Shared by the page and the
 * top bar's hover prefetch, so a hover followed by a click is one request.
 */
export function loadHomeBundle(queryClient: QueryClient): Promise<void> {
  if (loadedOnce) return Promise.resolve();
  inFlight ??= fetch("/api/home")
    .then((res) => (res.ok ? (res.json() as Promise<HomeBundle>) : null))
    .then((bundle) => {
      if (!bundle) return;
      if (bundle.market.trending) {
        queryClient.setQueryData(marketQueryKey("trending"), acceptMarket(bundle.market.trending));
      }
      if (bundle.market.volume) {
        queryClient.setQueryData(marketQueryKey("volume"), acceptMarket(bundle.market.volume));
      }
      if (bundle.newTokens) {
        queryClient.setQueryData(NEW_TOKENS_KEY, {
          pages: [acceptNewTokensPage(bundle.newTokens)],
          pageParams: [null],
        });
      }
      if (bundle.news) {
        const {queryKey} = newsFeedQuery(bundle.news.window as NewsWindow, bundle.news.topic as NewsTopic);
        queryClient.setQueryData(queryKey, bundle.news.body);
      }
      if (bundle.chart) {
        queryClient.setQueryData(["chart", "rwa", bundle.chart.id, bundle.chart.timeframe], bundle.chart.body);
      }
      loadedOnce = true;
    })
    .catch(() => undefined)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function useHomeBundle(): boolean {
  const queryClient = useQueryClient();
  // Back on Home a second time, the cards' own caches are already warm.
  const [ready, setReady] = useState(loadedOnce);

  useEffect(() => {
    if (loadedOnce) return;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setReady(true);
    };
    const timer = window.setTimeout(finish, MAX_WAIT_MS);
    void loadHomeBundle(queryClient).finally(() => {
      window.clearTimeout(timer);
      finish();
    });
    return () => window.clearTimeout(timer);
  }, [queryClient]);

  return ready;
}
