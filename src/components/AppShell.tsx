"use client";

import {useEffect, type ReactNode} from "react";
import {useRouter} from "next/navigation";
import {useUser} from "@/hooks/useUser";
import {TabBar} from "./TabBar";

export function AppShell({children}: {children: ReactNode}) {
  const router = useRouter();
  const {ready, authenticated} = useUser();

  useEffect(() => {
    if (ready && !authenticated) router.replace("/");
  }, [ready, authenticated, router]);

  if (!ready || !authenticated) {
    return <div className="h-full bg-premium" />;
  }

  return (
    <div className="flex h-full flex-col bg-premium">
      <div className="scroll-quiet flex-1 overflow-y-auto px-[22px] pt-[26px] pb-[calc(96px+env(safe-area-inset-bottom))]">
        {children}
      </div>

      <TabBar />
    </div>
  );
}
