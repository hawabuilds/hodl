"use client";

import {useEffect, type ReactNode} from "react";
import {useRouter} from "next/navigation";
import {hasCachedMe} from "@/lib/localStore";
import {isPrivyOAuthReturn} from "@/lib/session";
import {useUser} from "@/hooks/useUser";
import {cn} from "@/lib/cn";
import {TabBar} from "./TabBar";
import {PushPrompt} from "./PushPrompt";

/**
 * Status bar / Dynamic Island inset, plus a little extra so titles do not
 * sit against the cutout. Lives on sticky headers (Home, News) and on other
 * app pages — not on the scroller, or sticky `top: 0` would stack it twice.
 */
export const APP_SCROLL_PAD_TOP =
  "pt-[calc(26px+env(safe-area-inset-top,0px))]";

/**
 * Title + filter block that stays put while the feed scrolls.
 *
 * Opaque `bg-card` (`bg-premium` is a background-image token and does not
 * paint). The safe-area padding is on this bar, so at rest and while stuck
 * the titles sit in the same place, and rows cannot show through.
 */
export function StickyPageHeader({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "sticky top-0 z-20 -mx-[22px] border-b border-hairline bg-card px-[22px]",
        APP_SCROLL_PAD_TOP,
        className,
      )}
      style={{backgroundColor: "var(--card)"}}
    >
      {children}
    </div>
  );
}

export function AppShell({children}: {children: ReactNode}) {
  const router = useRouter();
  const {ready, authenticated} = useUser();
  const cached = hasCachedMe();

  useEffect(() => {
    if (isPrivyOAuthReturn()) return;
    if (ready && !authenticated) router.replace("/");
  }, [ready, authenticated, router]);

  if (ready && !authenticated) {
    return <div className="h-full bg-premium" />;
  }
  if (!ready && !cached) {
    return <div className="h-full bg-premium" />;
  }

  return (
    <div className="flex h-full flex-col bg-premium">
      <div className="scroll-quiet min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-[22px] pb-[calc(96px+env(safe-area-inset-bottom))]">
        {children}
      </div>

      <TabBar />
      <PushPrompt />
    </div>
  );
}
