"use client";

import {useCallback, useState, type ReactNode} from "react";
import dynamic from "next/dynamic";
import {usePathname} from "next/navigation";

import {PushPrompt} from "../PushPrompt";
import {useCreateIntent} from "@/lib/createIntent";
import {ListRail} from "./ListRail";
import {StatusBar} from "./StatusBar";
import {TopBar} from "./TopBar";

const CreateSheet = dynamic(
  () => import("../CreateSheet").then((m) => ({default: m.CreateSheet})),
  {ssr: false},
);

/**
 * The app at 1024px and up: a top bar, the page, and a status line.
 *
 * Three kinds of page live in it, and they want different things from the
 * space between the bars:
 *
 *  - The board (`/home`) fills it edge to edge with columns that each scroll
 *    on their own, so the shell must not scroll.
 *  - A token or stock page gets the list rail on its left and lays out its own
 *    panes, which also scroll individually.
 *  - Your portfolio lays out its own panels too, and scrolls inside them.
 *  - News is a front page: it uses the full width and scrolls as one.
 *  - Everything else — search, someone else's profile, an article — is a
 *    reading page. Stretched across 1440px a feed row is mostly empty space,
 *    so it sits in a centred column and scrolls as one, the way it does on a
 *    phone.
 *
 * The rail is rendered here rather than by the token page so that moving from
 * one token to the next leaves it alone.
 */
export function TerminalShell({children}: {children: ReactNode}) {
  const pathname = usePathname() ?? "";
  const board = pathname === "/home";
  const asset = pathname.startsWith("/token/") || pathname.startsWith("/rwa/");
  const portfolio = pathname === "/profile";
  const frontPage = pathname === "/news";

  const [createOpen, setCreateOpen] = useState(false);
  useCreateIntent(useCallback(() => setCreateOpen(true), []));

  return (
    <div className="flex h-full flex-col bg-[var(--frame-chrome)]">
      <TopBar />

      <div className="flex min-h-0 flex-1">
        {asset ? <ListRail /> : null}

        {board || asset || portfolio ? (
          <main className="min-h-0 min-w-0 flex-1">{children}</main>
        ) : frontPage ? (
          <main className="scroll-quiet min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</main>
        ) : (
          <main className="scroll-quiet min-h-0 min-w-0 flex-1 overflow-y-auto bg-surface-base">
            <div className="mx-auto w-full max-w-[760px] px-[22px] pb-12">{children}</div>
          </main>
        )}
      </div>

      <StatusBar />
      <CreateSheet open={createOpen} onClose={() => setCreateOpen(false)} />
      <PushPrompt />
    </div>
  );
}
