"use client";

import {useEffect, useRef, useState} from "react";

const EAGER = 15;

function decodeUrl(url: string, priority: "high" | "low"): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    if ("fetchPriority" in image) {
      (image as HTMLImageElement & {fetchPriority: string}).fetchPriority =
        priority;
    }
    const done = () => resolve();
    image.onload = done;
    image.onerror = done;
    image.src = url;
    if (image.decode) {
      void image.decode().then(done).catch(done);
    }
  });
}

/**
 * Decode the visible page of feed PFPs together, then let the rest load lazy.
 *
 * The first ~15 URLs are known the moment the page returns — wait for those
 * to decode so every on-screen logo appears in one frame instead of popping
 * in per origin.
 */
export function useFeedLogos(urls: (string | null | undefined)[]): boolean {
  const eager = urls.filter((url): url is string => Boolean(url)).slice(0, EAGER);
  const rest = urls.filter((url): url is string => Boolean(url)).slice(EAGER);
  const key = eager.join("|");
  const [ready, setReady] = useState(eager.length === 0);
  const prevKey = useRef("");

  useEffect(() => {
    const prev = prevKey.current.split("|").filter(Boolean);
    const incremental = prev.length > 0 && eager.some((url) => prev.includes(url));
    prevKey.current = key;

    if (eager.length === 0) {
      setReady(true);
      return;
    }
    for (const url of rest) void decodeUrl(url, "low");
    if (incremental) return;

    let cancelled = false;
    setReady(false);
    void Promise.all(eager.map((url) => decodeUrl(url, "high"))).then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
    // key is the eager set; rest is preloaded as a side effect of that set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return ready;
}

export async function decodeTokenImage(url: string | null | undefined): Promise<void> {
  if (!url) return;
  await decodeUrl(url, "high");
}
