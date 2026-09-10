"use client";

import Link from "next/link";
import {relativeTime} from "@/lib/format";
import {newsArticlePath} from "@/lib/routes";
import type {NewsItem} from "@/lib/types";
import {PanelError, PanelNote} from "./TradesPanel";

export function NewsPanel({
  items,
  isLoading,
  seeded,
  error,
  onRetry,
}: {
  items: NewsItem[];
  isLoading: boolean;
  /** True while the headlines are placeholders rather than a real feed. */
  seeded: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  if (isLoading && items.length === 0) return <PanelNote>Loading news</PanelNote>;
  if (error && items.length === 0) {
    return <PanelError message={error} onRetry={onRetry} />;
  }
  if (items.length === 0) return <PanelNote>No recent coverage.</PanelNote>;

  return (
    <div>
      {seeded ? (
        <p className="mb-2 rounded-2xl bg-[var(--segment-track)] px-3 py-2 text-[11.5px] font-medium leading-[1.45] text-faint shadow-inset-soft">
          Sample headlines. Connect a news provider to replace them.
        </p>
      ) : null}
      <ul>
        {items.map((item) => {
          const live = item.url !== "#";
          const body = (
            <>
              <div className="text-[13.5px] font-semibold leading-[1.4] tracking-[-0.01em]">
                {item.title}
              </div>
              <div className="mt-1 text-[12px] font-medium text-faint">
                {item.source} · {relativeTime(item.publishedAt)}
              </div>
            </>
          );

          return (
            <li key={item.id}>
              {live ? (
                <Link
                  href={newsArticlePath(item.id)}
                  className="block py-3 transition-colors hover:text-accent-link"
                >
                  {body}
                </Link>
              ) : (
                <div className="py-3">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
