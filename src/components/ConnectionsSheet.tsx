"use client";

import Link from "next/link";
import {compact, compactMoney} from "@/lib/format";
import {profilePath} from "@/lib/routes";
import type {Profile} from "@/lib/types";
import {Avatar} from "./ui/Avatar";
import {Sheet, SheetTitle} from "./ui/Sheet";

/**
 * Followers and following, for anyone's profile.
 *
 * One component for both directions and both the signed-in account and other
 * people's pages, so a row reads the same wherever it is opened from.
 */
export function ConnectionsSheet({
  open,
  title,
  people,
  loading,
  emptyLabel,
  onClose,
}: {
  open: boolean;
  title: string;
  people: Profile[];
  loading?: boolean;
  emptyLabel: string;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      height="auto"
      label={title}
      header={<SheetTitle title={title} onClose={onClose} />}
    >
      {loading ? (
        <p className="py-8 text-center text-[13px] text-muted">Loading</p>
      ) : people.length === 0 ? (
        <p className="mx-auto max-w-[30ch] py-8 text-center text-[13px] leading-[1.5] text-muted">
          {emptyLabel}
        </p>
      ) : (
        <ul className="-mx-[22px] pb-2 pt-1">
          {people.map((person) => (
            <li key={person.handle}>
              <Link
                href={profilePath(person.handle)}
                onClick={onClose}
                className="flex items-center gap-3 px-[22px] py-2.5 transition-colors hover:bg-[var(--overlay-wash)]"
              >
                <Avatar name={person.displayName} src={person.pfpUrl} size={38} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-extrabold tracking-[-0.015em]">
                    {person.displayName}
                  </div>
                  <div className="truncate text-[12px] font-semibold text-faint">
                    @{person.handle} · {compact(person.followers)} followers
                  </div>
                </div>
                <span className="tabular-nums shrink-0 text-[12.5px] font-bold text-muted">
                  {compactMoney(
                    person.holdings.reduce((sum, h) => sum + h.valueUsd, 0),
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
