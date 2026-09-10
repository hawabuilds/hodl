"use client";

import {useEffect, useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {useQuery} from "@tanstack/react-query";
import {AssetLink} from "@/components/AssetLink";
import {APP_SCROLL_PAD_TOP} from "@/components/AppShell";
import {VerifiedTick} from "@/components/ui/Badges";
import {ArrowUpRightIcon, ChevronLeftIcon} from "@/components/ui/Icons";
import {cn} from "@/lib/cn";
import {relativeTime} from "@/lib/format";
import type {FeedItem} from "@/lib/types";

interface ArticleResponse {
  article: FeedItem;
}

export default function NewsArticlePage({params}: {params: {id: string}}) {
  const id = decodeURIComponent(params.id);
  const router = useRouter();

  const article = useQuery({
    queryKey: ["news-article", id],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const res = await fetch(`/api/news/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error("Could not load this article.");
      return (await res.json()) as ArticleResponse;
    },
  });

  return (
    <div className={cn("-mx-[22px]", APP_SCROLL_PAD_TOP)}>
      <header className="sticky top-0 z-20 bg-surface-base px-[22px] pb-3 shadow-[0_8px_24px_-20px_var(--shadow-color)]">
        <button
          type="button"
          onClick={() => router.back()}
          className="-ml-1.5 inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[13px] font-semibold text-muted transition-colors hover:bg-[var(--overlay-wash)] hover:text-ink"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          Back
        </button>
      </header>

      {article.isLoading ? (
        <ArticleSkeleton />
      ) : article.error ? (
        <div className="px-[22px] py-16 text-center">
          <p className="text-[14px] font-bold text-ink">Article unavailable</p>
          <p className="mt-2 text-[13px] text-muted">
            {(article.error as Error).message}
          </p>
          <Link
            href="/news"
            className="mt-5 inline-flex rounded-xl bg-input px-4 py-2.5 text-[13px] font-bold text-ink shadow-card transition-[background-color,box-shadow] hover:bg-[var(--overlay-wash)] hover:shadow-lift"
          >
            Back to News
          </Link>
        </div>
      ) : article.data ? (
        <ArticleBody item={article.data.article} />
      ) : null}
    </div>
  );
}

function ArticleBody({item}: {item: FeedItem}) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = item.imageUrl && !imageFailed;

  return (
    <article>
      {showImage ? (
        <div className="overflow-hidden bg-[var(--overlay-wash)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.imageUrl!}
            alt=""
            fetchPriority="high"
            onError={() => setImageFailed(true)}
            className="max-h-[280px] w-full object-cover"
          />
        </div>
      ) : null}

      <div className="px-[22px] pb-10 pt-5">
        <div className="flex items-center gap-2 text-[12px] font-semibold">
          <span
            aria-hidden="true"
            className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-[var(--overlay-wash)] text-[10px] font-extrabold text-muted"
          >
            {item.source.slice(0, 1)}
          </span>
          <span className="text-ink">{item.source}</span>
          <span className="text-faint">·</span>
          <time className="text-muted" dateTime={item.publishedAt}>
            <LiveRelativeTime iso={item.publishedAt} />
          </time>
        </div>

        <h1 className="mt-4 text-[26px] font-extrabold leading-[1.22] tracking-[-0.032em] text-ink">
          {item.body}
        </h1>

        {item.summary ? (
          <p className="mt-5 text-[16px] font-normal leading-[1.62] tracking-[-0.01em] text-ink/90">
            {item.summary}
          </p>
        ) : null}

        {item.tickers.length > 0 ? (
          <div className="mt-6 flex flex-wrap gap-1.5">
            {item.tickers.map((ticker) => (
              <AssetLink
                key={ticker}
                kind="rwa"
                id={ticker}
                className="flex items-center gap-1 rounded-[7px] bg-[var(--overlay-wash)] px-2.5 py-1.5 text-[12px] font-extrabold text-ink transition-colors hover:bg-[var(--overlay-wash-hover)]"
              >
                {ticker}
                <VerifiedTick size={12} />
              </AssetLink>
            ))}
          </div>
        ) : null}

        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "mt-8 flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3.5",
            "bg-input text-[15px] font-extrabold tracking-[-0.015em] text-ink",
            "shadow-card transition-[background-color,box-shadow] duration-150",
            "hover:bg-[var(--overlay-wash)] hover:shadow-lift",
            "active:bg-[var(--overlay-wash-hover)]",
          )}
        >
          Read full article
          <ArrowUpRightIcon className="h-4 w-4 shrink-0 text-accent-link" />
        </a>
      </div>
    </article>
  );
}

/** Ticks every minute so "3m ago" stays honest while the reader is open. */
function LiveRelativeTime({iso}: {iso: string}) {
  const [label, setLabel] = useState(() => relativeTime(iso));

  useEffect(() => {
    setLabel(relativeTime(iso));
    const timer = window.setInterval(() => setLabel(relativeTime(iso)), 60_000);
    return () => window.clearInterval(timer);
  }, [iso]);

  return <>{label}</>;
}

function ArticleSkeleton() {
  return (
    <div className="px-[22px] pb-10 pt-2">
      <div className="-mx-[22px] mb-5 h-[220px] animate-pulse bg-[var(--overlay-wash)]" />
      <div className="h-3 w-32 animate-pulse rounded bg-[var(--overlay-wash)]" />
      <div className="mt-5 h-7 w-full animate-pulse rounded bg-[var(--overlay-wash)]" />
      <div className="mt-2.5 h-7 w-4/5 animate-pulse rounded bg-[var(--overlay-wash)]" />
      <div className="mt-6 space-y-2">
        <div className="h-3.5 w-full animate-pulse rounded bg-[var(--overlay-wash)]" />
        <div className="h-3.5 w-full animate-pulse rounded bg-[var(--overlay-wash)]" />
        <div className="h-3.5 w-2/3 animate-pulse rounded bg-[var(--overlay-wash)]" />
      </div>
      <div className="mt-8 h-[52px] animate-pulse rounded-2xl bg-input shadow-inset-soft" />
    </div>
  );
}
