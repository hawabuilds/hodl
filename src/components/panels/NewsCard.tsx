"use client";

import Link from "next/link";
import {useState} from "react";
import {relativeTime} from "@/lib/format";
import {newsArticlePath} from "@/lib/routes";
import type {NewsItem} from "@/lib/types";
import {NewsImage} from "../ui/NewsImage";
import {PanelError} from "./TradesPanel";

/** Stories shown before "See all". */
const FIRST = 5;

/**
 * A stock's news in the desktop page's right column, under the order ticket:
 * the same stories as the News tab it replaces, sized for a 360px column —
 * headline, source · time, and a small picture where the story has one.
 */
export function NewsCard({
  items,
  isLoading,
  error,
  onRetry,
}: {
  items: NewsItem[];
  isLoading: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, FIRST);

  return (
    <section aria-label="News" className="rounded-[14px] border border-[var(--overlay-wash)] bg-surface-base px-5 pb-2 pt-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-extrabold tracking-[-0.01em]">News</h2>
        {items.length > FIRST ? (
          <button
            type="button"
            onClick={() => setAll((open) => !open)}
            className="text-[13px] font-bold text-accent-link hover:underline"
          >
            {all ? "Show less" : "See all"}
          </button>
        ) : null}
      </div>

      {isLoading && items.length === 0 ? (
        <div aria-busy="true" className="mt-2">
          {Array.from({length: 3}, (_, i) => (
            <div key={i} className="my-3 h-[52px] animate-pulse rounded-xl bg-[var(--overlay-wash)]" />
          ))}
        </div>
      ) : error && items.length === 0 ? (
        <div className="py-3">
          <PanelError message={error} onRetry={onRetry} />
        </div>
      ) : items.length === 0 ? (
        <p className="py-4 text-[13px] text-faint">No recent coverage.</p>
      ) : (
        <ul className="mt-1">
          {shown.map((item) => {
            const body = (
              <>
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-[13.5px] font-bold leading-[1.35] tracking-[-0.01em] group-hover:text-accent-link">
                    {item.title}
                  </div>
                  <div className="mt-1 truncate text-[12px] font-semibold text-muted">
                    {item.source} <span className="font-normal text-faint">· {relativeTime(item.publishedAt)}</span>
                  </div>
                </div>
                {item.imageUrl ? (
                  <div className="h-[52px] w-[68px] shrink-0 overflow-hidden rounded-lg bg-[var(--overlay-wash)]">
                    <NewsImage src={item.imageUrl} width={240} className="h-full w-full object-cover" />
                  </div>
                ) : null}
              </>
            );
            return (
              <li key={item.id} className="border-t border-[var(--overlay-wash)] first:border-t-0">
                {item.url !== "#" ? (
                  <Link href={newsArticlePath(item.id)} className="group flex items-center gap-3 py-3">
                    {body}
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 py-3">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
