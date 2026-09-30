"use client";

import {Component, type ReactNode} from "react";
import Link from "next/link";
import {cn} from "@/lib/cn";

/**
 * The frame every card on Home shares: a title, an optional "See all", and a
 * body that loads, fails and empties on its own.
 */
export function SummaryCard({
  title,
  action,
  children,
  className,
}: {
  title: ReactNode;
  /** Top-right of the header: a "See all", or a link to the asset. */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col rounded-2xl border border-[var(--overlay-wash)] bg-surface-base px-[var(--home-card-px,16px)] pb-[var(--home-card-pb,8px)] pt-[var(--home-card-pt,16px)]",
        className,
      )}
    >
      <header className="mb-1 flex items-start justify-between gap-3">
        {/* Wraps rather than cutting off: at 1280px a card is 300px wide, and
            "News on the RWAs behind the tokens" does not fit on one line. */}
        <h2 className="line-clamp-2 min-w-0 text-[length:var(--home-t-title,15px)] font-extrabold leading-[1.25] tracking-[-0.02em]">
          {title}
        </h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export function SeeAll({href, children}: {href: string; children: ReactNode}) {
  return (
    <Link
      href={href}
      prefetch
      className="shrink-0 text-[length:var(--home-t-small,12px)] font-bold text-accent-link transition-colors hover:text-ink"
    >
      {children}
    </Link>
  );
}

/** Placeholder rows the height of the real ones, so the card does not jump. */
export function RowsSkeleton({count}: {count: number}) {
  return (
    <ul aria-hidden="true">
      {Array.from({length: count}).map((_, i) => (
        <li key={i} className="flex h-[var(--home-row,48px)] items-center gap-3">
          <span className="h-[var(--home-logo,28px)] w-[var(--home-logo,28px)] shrink-0 animate-pulse rounded-full bg-[var(--overlay-wash)]" />
          <span className="min-w-0 flex-1">
            <span className="block h-3.5 w-24 animate-pulse rounded bg-[var(--overlay-wash)]" />
            <span className="mt-2 block h-3 w-16 animate-pulse rounded bg-[var(--overlay-wash)]" />
          </span>
          <span className="h-3.5 w-14 animate-pulse rounded bg-[var(--overlay-wash)]" />
        </li>
      ))}
    </ul>
  );
}

/** A card that could not load, saying so on itself and nowhere else. */
export function CardError({onRetry}: {onRetry?: () => void}) {
  return (
    <div role="status" className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
      <p className="text-[13px] font-semibold text-muted">Couldn&apos;t load</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="text-[12.5px] font-bold text-accent-link transition-colors hover:text-ink"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function CardNote({children}: {children: ReactNode}) {
  return (
    <p className="flex-1 py-8 text-center text-[13px] leading-[1.5] text-faint">{children}</p>
  );
}

/**
 * Catches a card that throws while rendering, so it fails alone.
 *
 * Data failures are handled inside each card; this is the backstop for a bug,
 * which would otherwise take every other card on the page down with it.
 */
export class CardBoundary extends Component<
  {title: string; className?: string; children: ReactNode},
  {failed: boolean}
> {
  state = {failed: false};

  static getDerivedStateFromError() {
    return {failed: true};
  }

  componentDidCatch(error: unknown) {
    console.error(`home card "${this.props.title}" failed`, error);
  }

  render() {
    if (this.state.failed) {
      return (
        <SummaryCard title={this.props.title} className={this.props.className}>
          <CardError onRetry={() => this.setState({failed: false})} />
        </SummaryCard>
      );
    }
    return this.props.children;
  }
}
