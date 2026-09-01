"use client";

import {useEffect, useState} from "react";
import {useQuery} from "@tanstack/react-query";
import type {Asset} from "@/lib/types";

/**
 * Server-side search across tickers, symbols, names and contract addresses.
 *
 * Debounced rather than fired per keystroke: a pasted address arrives as one
 * change, but a typed ticker arrives as four, and three of those requests are
 * answers nobody reads.
 */
export function useSearch(query: string) {
  const [debounced, setDebounced] = useState(query);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query), 180);
    return () => window.clearTimeout(id);
  }, [query]);

  const trimmed = debounced.trim();

  const search = useQuery({
    queryKey: ["search", trimmed],
    enabled: trimmed.length > 0,
    queryFn: async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
      if (!res.ok) throw new Error("Search failed.");
      return (await res.json()) as {results: Asset[]};
    },
  });

  return {
    active: trimmed.length > 0,
    results: search.data?.results ?? [],
    // Only the first load of a query is worth a spinner; a refetch keeps the
    // previous results on screen.
    isLoading: search.isLoading && trimmed.length > 0,
  };
}
