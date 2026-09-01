"use client";

import {relativeTime} from "@/lib/format";
import type {NewsItem} from "@/lib/types";
import {PanelNote} from "./TradesPanel";

export function NewsPanel({
  items,
  isLoading,
  seeded,
}: {
  items: NewsItem[];
  isLoading: boolean;
  /** True while the headlines are placeholders rather than a real feed. */
  seeded: boolean;
}) {
  if (isLoading && items.length === 0) return <PanelNote>Loading news</PanelNote>;
  if (items.length === 0) return <PanelNote>No recent coverage.</PanelNote>;

  return (
    <div>
      {seeded ? (
        <p className="mb-2 rounded-[12px] border border-hairline bg-wash px-3 py-2 text-[11.5px] font-medium leading-[1.45] text-faint">
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
            <li key={item.id} className="border-b border-hairline last:border-b-0">
              {live ? (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block py-3 transition-colors hover:text-green-deep"
                >
                  {body}
                </a>
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
