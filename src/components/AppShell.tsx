"use client";

import {useEffect, type ReactNode} from "react";
import {useRouter} from "next/navigation";
import {hasCachedMe} from "@/lib/localStore";
import {isPrivyOAuthReturn} from "@/lib/session";
import {useUser} from "@/hooks/useUser";
import {TabBar} from "./TabBar";
import {PushPrompt} from "./PushPrompt";

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
      <div className="scroll-quiet min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-[22px] pt-[calc(26px+env(safe-area-inset-top,0px))] pb-[calc(96px+env(safe-area-inset-bottom))]">
        {children}
      </div>

      <TabBar />
      <PushPrompt />
    </div>
  );
}
