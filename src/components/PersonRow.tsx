"use client";

import Link from "next/link";
import {compact, compactMoney} from "@/lib/format";
import {profilePath} from "@/lib/routes";
import {cn} from "@/lib/cn";
import type {Profile} from "@/lib/types";
import {Avatar} from "./ui/Avatar";

/** A person in search results: who they are, what they hold, who follows them. */
export function PersonRow({
  person,
  dense = false,
}: {
  person: Profile;
  /** Tighter side padding, for a row inside a panel rather than a full screen. */
  dense?: boolean;
}) {
  const value = person.holdings.reduce((sum, h) => sum + h.valueUsd, 0);

  return (
    <li>
      <Link
        href={profilePath(person.handle)}
        className={cn(
          "flex items-center gap-3 py-[13px] transition-colors hover:bg-[var(--overlay-wash)]",
          dense ? "px-3.5" : "px-[22px]",
        )}
      >
        <Avatar name={person.displayName} src={person.pfpUrl} size={40} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14.5px] font-extrabold tracking-[-0.015em]">
            {person.displayName}
          </div>
          <div className="truncate text-[12.5px] font-semibold text-faint">
            @{person.handle}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="tabular-nums text-[13.5px] font-extrabold tracking-[-0.015em]">
            {compactMoney(value)}
          </div>
          <div className="tabular-nums text-[11.5px] font-semibold text-faint">
            {compact(person.followers)} followers
          </div>
        </div>
      </Link>
    </li>
  );
}
