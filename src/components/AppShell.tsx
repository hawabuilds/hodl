"use client";

import {useEffect, type ReactNode} from "react";
import {useRouter} from "next/navigation";
import {useUser} from "@/hooks/useUser";
import {ProfileMenu} from "./ProfileMenu";
import {TabBar} from "./TabBar";
import {Logo} from "./ui/Logo";

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
      <header className="flex items-center justify-between px-[22px] pb-1.5 pt-[22px]">
        <Logo size="sm" />
        <ProfileMenu />
      </header>

      <div className="scroll-quiet flex-1 overflow-y-auto px-[22px] pt-2.5 pb-[calc(96px+env(safe-area-inset-bottom))]">
        <div className="animate-rise">{children}</div>
      </div>

      <TabBar />
    </div>
  );
}
