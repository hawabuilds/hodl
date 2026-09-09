"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import {APP_NAME} from "@/config/app";
import {APP_SCROLL_PAD_TOP} from "@/components/AppShell";
import {HomeTabs} from "@/components/HomeTabs";
import {FilterRail} from "@/components/FilterRail";
import {PriceDelta} from "@/components/ui/PriceDelta";
import {PairTicker} from "@/components/ui/Badges";
import {Sparkline} from "@/components/Sparkline";
import {Avatar} from "@/components/ui/Avatar";
import {HomeIcon, NewsIcon, SearchIcon, UserIcon} from "@/components/ui/Icons";
import {cn} from "@/lib/cn";
import type {ChartPoint} from "@/lib/types";

const PriceChart = dynamic(
  () => import("@/components/PriceChart").then((m) => ({default: m.PriceChart})),
  {ssr: false, loading: () => <div className="mt-3 h-[220px] animate-pulse rounded-xl bg-wash" />},
);

const MOCK_SERIES = [
  0.42, 0.44, 0.43, 0.46, 0.48, 0.47, 0.49, 0.52, 0.51, 0.54, 0.56, 0.55,
];

const FEED_ROWS = [
  {symbol: "SNOW", pair: "DIH", vol: "$842K", age: "2h", mc: "$4.2M", change: 12.4, up: true},
  {symbol: "BIDEN", pair: "DIH", vol: "$1.1M", age: "5h", mc: "$8.7M", change: -3.2, up: false},
  {symbol: "PEPE", pair: "DIH", vol: "$620K", age: "1d", mc: "$2.1M", change: 6.8, up: true},
  {symbol: "TRUMP", pair: "DIH", vol: "$2.4M", age: "3d", mc: "$12.4M", change: -1.1, up: false},
  {symbol: "DOGE", pair: "DIH", vol: "$980K", age: "4d", mc: "$5.6M", change: 0.4, up: true},
];

function chartPoints(): ChartPoint[] {
  const now = Date.now();
  return MOCK_SERIES.map((price, i) => ({
    t: now - (MOCK_SERIES.length - i) * 60_000,
    price,
  }));
}

function StaticTabBar() {
  return (
    <nav
      aria-label="Primary"
      className="pointer-events-none absolute inset-x-0 z-40 flex justify-center px-[22px] bottom-[calc(14px+env(safe-area-inset-bottom))]"
    >
      <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-surface-elevated/80 p-1.5 shadow-panel backdrop-blur-[22px]">
        {[HomeIcon, SearchIcon, NewsIcon, UserIcon].map((Icon, i) => (
          <div
            key={i}
            className={cn(
              "grid h-[46px] w-[54px] place-items-center rounded-full",
              i === 0
                ? "bg-[var(--overlay-wash-hover)] text-ink shadow-[0_6px_18px_-10px_rgba(104,96,255,0.45)]"
                : "text-faint",
            )}
          >
            <Icon className="h-[22px] w-[22px]" />
          </div>
        ))}
      </div>
    </nav>
  );
}

/** Dev-only home feed mock — same structure as /home New sort. */
export function PaletteFeedMock() {
  return (
    <div className="relative flex h-full flex-col bg-surface-base">
      <div className="scroll-quiet min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-[22px] pb-[calc(96px+env(safe-area-inset-bottom))]">
        <div
          className={cn(
            "sticky top-0 z-20 -mx-[22px] bg-surface-base px-[22px] shadow-[0_8px_24px_-20px_var(--shadow-color)]",
            APP_SCROLL_PAD_TOP,
          )}
          style={{backgroundColor: "var(--surface-base)"}}
        >
          <div className="flex items-center justify-between pb-3">
            <Image
              src="/brand/logo-white-text.svg"
              alt={APP_NAME}
              width={88}
              height={24}
              priority
              className="h-[22px] w-auto"
            />
            <button
              type="button"
              className="rounded-pill bg-brand-500 px-4 py-2 text-[14px] font-bold text-white"
            >
              Connect
            </button>
          </div>
          <HomeTabs value="tokens" onChange={() => {}} />
          <div className="py-3">
            <FilterRail
              label="Sort"
              value="new"
              onChange={() => {}}
              options={[
                {value: "trending", label: "Trending"},
                {value: "new", label: "New"},
                {value: "marketCap", label: "Market cap"},
              ]}
            />
          </div>
        </div>

        <div className="-mx-[22px]">
          {FEED_ROWS.map((row) => (
            <div
              key={row.symbol}
              className="flex items-center gap-3 px-[22px] py-[13px] transition-colors hover:bg-[var(--overlay-wash)]"
            >
              <Avatar name={row.symbol} seed={row.symbol} size={40} />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[15px] font-extrabold tracking-[-0.015em]">
                    {row.symbol}
                  </span>
                  <PairTicker ticker={row.pair} />
                </div>
                <div className="mt-[3px] flex items-center gap-2.5 truncate text-[12.5px] font-semibold">
                  <span className="text-faint">{row.vol} Vol</span>
                  <span className="text-muted">{row.age}</span>
                </div>
              </div>
              <Sparkline
                series={MOCK_SERIES}
                positive={row.up}
                className="h-[28px] w-[52px] shrink-0"
              />
              <div className="flex shrink-0 flex-col items-end gap-[3px] text-right">
                <span className="tabular-nums text-[15px] font-extrabold tracking-[-0.02em]">
                  {row.mc}
                  <span className="ml-1 text-[11px] font-bold text-faint">MC</span>
                </span>
                <PriceDelta value={row.change} className="text-[12.5px] font-bold" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <StaticTabBar />
    </div>
  );
}

/** Dev-only token page mock — chart + price header. */
export function PaletteTokenMock() {
  const points = chartPoints();
  const change = 8.42;

  return (
    <div className="relative flex h-full flex-col bg-surface-base pb-[calc(96px+env(safe-area-inset-bottom))]">
      <div className={cn("px-[22px]", APP_SCROLL_PAD_TOP)}>
        <div className="flex items-center gap-2 py-2">
          <span className="text-faint">←</span>
          <span className="text-[13px] font-bold text-muted">Back</span>
        </div>

        <div className="mt-3 flex items-start gap-3">
          <Avatar name="SNOW" seed="SNOW" size={44} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1">
              <h1 className="truncate text-[20px] font-extrabold tracking-[-0.03em]">SNOW</h1>
            </div>
            <div className="-mt-0.5 truncate text-[13px] font-semibold text-faint">
              Snowball Protocol
            </div>
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="rounded-[8px] bg-[var(--overlay-wash)] px-2 py-1 text-[11.5px] font-extrabold text-muted">
            SNOW / DIH
          </span>
        </div>

        <div className="mt-4 flex items-end justify-between gap-3">
          <div>
            <div className="tabular-nums text-[32px] font-extrabold leading-none tracking-[-0.035em]">
              $0.5421
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[13.5px] font-bold">
              <PriceDelta value={change} />
              <span className="font-semibold text-faint">1m</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-faint">
              Market cap
            </div>
            <div className="tabular-nums text-[15px] font-extrabold tracking-[-0.02em]">
              $4.2M
            </div>
          </div>
        </div>

        <div className="mt-3 flex gap-1">
          {["1m", "5m", "1h", "1D"].map((tf) => (
            <button
              key={tf}
              type="button"
              className={cn(
                "rounded-pill px-3 py-1.5 text-[12px] font-bold",
                tf === "1m"
                  ? "bg-brand-500 text-white"
                  : "text-faint hover:text-muted",
              )}
            >
              {tf}
            </button>
          ))}
        </div>

        <PriceChart points={points} height={220} className="mt-3" positive />

        <div className="mt-4 overflow-hidden rounded-2xl bg-surface-elevated shadow-card">
          <div className="grid grid-cols-2 gap-x-3 px-4 py-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-faint">
                Liquidity
              </div>
              <div className="tabular-nums text-[14px] font-extrabold">$842K</div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-faint">
                Holders
              </div>
              <div className="tabular-nums text-[14px] font-extrabold">1,284</div>
            </div>
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-[calc(14px+env(safe-area-inset-bottom))] z-40 flex justify-center px-[22px]">
        <div className="pointer-events-auto grid w-full max-w-[380px] grid-cols-2 gap-2.5 rounded-[19px] bg-surface-elevated/92 p-2 shadow-panel backdrop-blur-[16px]">
          <button
            type="button"
            className="rounded-[14px] bg-price-up py-3.5 text-[15px] font-bold text-[var(--surface-pressed)]"
          >
            Buy
          </button>
          <button
            type="button"
            className="rounded-[14px] bg-price-down py-3.5 text-[15px] font-bold text-white"
          >
            Sell
          </button>
        </div>
      </div>
    </div>
  );
}
