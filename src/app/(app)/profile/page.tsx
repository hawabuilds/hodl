"use client";

import {useMemo, useState} from "react";
import {EditProfileSheet} from "@/components/EditProfileSheet";
import {HoldingsList} from "@/components/HoldingsList";
import {PriceChart} from "@/components/PriceChart";
import {SettingsSheet} from "@/components/SettingsSheet";
import {SocialRow} from "@/components/SocialRow";
import {Avatar} from "@/components/ui/Avatar";
import {SectionLabel} from "@/components/ui/Card";
import {PencilIcon, SettingsIcon} from "@/components/ui/Icons";
import {useBook} from "@/hooks/useBook";
import {useMe} from "@/hooks/useMe";
import {cn} from "@/lib/cn";
import {money, percent, relativeTime, shortAddress, units} from "@/lib/format";
import type {ChartPoint} from "@/lib/types";

type Side = "rwa" | "token";

export default function ProfilePage() {
  const me = useMe();
  const book = useBook();
  const [side, setSide] = useState<Side>("rwa");
  const [editOpen, setEditOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // The chart takes the same shape as an asset chart so it can share the
  // component; the timestamps are only there to space the points evenly.
  const points: ChartPoint[] = useMemo(() => {
    const span = 24 * 60 * 60_000;
    const now = Date.now();
    return book.series.map((value, i) => ({
      t: now - span + (span * i) / Math.max(book.series.length - 1, 1),
      price: value,
    }));
  }, [book.series]);

  const pnl = useMemo(
    () =>
      new Map(
        book.holdings.map((h) => [h.assetId, {pnlUsd: h.pnlUsd, pnlPct: h.pnlPct}]),
      ),
    [book.holdings],
  );

  const shown = side === "rwa" ? book.rwaHoldings : book.tokenHoldings;
  const positive = book.changePct >= 0;

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={me.displayName} src={me.pfpUrl} size={52} ring />
          <div className="min-w-0">
            <div className="truncate text-[19px] font-extrabold tracking-[-0.03em]">
              {me.displayName}
            </div>
            <div className="truncate text-[12.5px] font-semibold text-faint">
              {me.handle ? `@${me.handle}` : "Signed in"}
              {me.wallet ? ` · ${shortAddress(me.wallet, 4)}` : ""}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
          className="-mr-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-[var(--overlay-wash)] hover:text-ink"
        >
          <SettingsIcon className="h-[19px] w-[19px]" />
        </button>
      </div>

      {me.bio ? (
        <p className="mb-3 text-[13.5px] leading-[1.5] text-muted">{me.bio}</p>
      ) : null}

      <div className="mb-5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setEditOpen(true)}
          className="flex items-center gap-1.5 rounded-pill border border-hairline bg-card px-3.5 py-2 text-[12.5px] font-bold text-ink transition-colors hover:border-[var(--border-hover-strong)]"
        >
          <PencilIcon className="h-3.5 w-3.5" />
          Edit profile
        </button>
        <SocialRow socials={me.socials} />
      </div>

      <div className="mb-5 rounded-panel border border-hairline bg-gradient-to-b from-card to-[var(--surface-elevated)] p-[22px] pb-4 shadow-panel">
        <div className="text-[11px] font-bold tracking-[0.09em] text-faint">
          PORTFOLIO VALUE
        </div>
        <div className="tnum my-[9px] text-[38px] font-extrabold tracking-[-0.035em]">
          {book.isLoading ? "—" : money(book.totalValue)}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] font-semibold">
          <span
            className={cn(
              "tnum font-bold",
              positive ? "text-green-deep" : "text-red",
            )}
          >
            {percent(book.changePct)} today
          </span>
          <span className="tnum text-muted">
            {money(book.cashUsd)} cash · {money(book.positionsValue)} in positions
          </span>
        </div>

        {points.length > 1 ? (
          <PriceChart
            points={points}
            height={110}
            positive={positive}
            showBaseline={false}
            className="mt-3"
          />
        ) : null}
      </div>

      <div className="mb-3 flex gap-0.5 rounded-[12px] border border-hairline bg-wash p-[3px]">
        {(
          [
            {value: "rwa", label: `RWAs ${book.rwaHoldings.length || ""}`},
            {value: "token", label: `Tokens ${book.tokenHoldings.length || ""}`},
          ] as const
        ).map((option) => {
          const active = option.value === side;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => setSide(option.value)}
              className={cn(
                "flex-1 rounded-[9px] py-2 text-[13px] font-extrabold transition-all duration-150",
                active
                  ? "bg-card text-ink shadow-[0_2px_6px_-3px_rgba(9,24,14,0.3)]"
                  : "text-faint",
              )}
            >
              {option.label.trim()}
            </button>
          );
        })}
      </div>

      <HoldingsList
        holdings={shown}
        pnl={pnl}
        empty={
          side === "rwa"
            ? "No tokenized stocks yet. Buy one from any RWA chart page."
            : "No tokens yet. Buy one from any token chart page."
        }
      />

      {book.orders.length > 0 ? (
        <>
          <SectionLabel>RECENT ORDERS</SectionLabel>
          <ul className="overflow-hidden rounded-[16px] border border-hairline bg-card">
            {book.orders.slice(0, 8).map((order) => (
              <li
                key={order.id}
                className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="text-[13px] font-extrabold">
                    <span
                      className={
                        order.side === "buy" ? "text-green-deep" : "text-red"
                      }
                    >
                      {order.side === "buy" ? "Bought" : "Sold"}
                    </span>{" "}
                    {order.symbol}
                  </div>
                  <div className="tnum mt-0.5 text-[11.5px] font-semibold text-faint">
                    {units(order.amount)} · {relativeTime(order.at)}
                  </div>
                </div>
                <div className="tnum shrink-0 text-[13px] font-extrabold">
                  {money(order.amountUsd)}
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <p className="mt-5 px-0.5 text-[11.5px] leading-[1.5] text-faint">
        This book is simulated. Orders are recorded in this browser only — no
        wallet is signed and no funds move.
      </p>

      <EditProfileSheet open={editOpen} onClose={() => setEditOpen(false)} />
      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
