"use client";

import {Suspense} from "react";
import {DenseHome} from "@/components/home/DenseHome";
import {HomeSummary} from "@/components/home/HomeSummary";
import {useIsDesktop} from "@/hooks/useBreakpoint";

/**
 * Home: the summary on a desktop; on a phone, the feed it has always been.
 *
 * The summary was designed for a laptop screen. A phone keeps the feed with
 * its Tokens / RWAs / Watchlist tabs, exactly as before the desktop site.
 */
export default function HomePage() {
  const desktop = useIsDesktop();
  if (!desktop) return <DenseHome route="tokens" />;
  return (
    <Suspense fallback={null}>
      <HomeSummary />
    </Suspense>
  );
}
