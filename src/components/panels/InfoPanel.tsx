"use client";

import {addressUrlForChain, RH_MAINNET_ID} from "@/config/chain";
import {
  ageSince,
  compact,
  compactMoney,
  price as fmtPrice,
  percent,
  shortAddress,
  stamp,
} from "@/lib/format";
import type {TokenAsset} from "@/lib/types";
import {cn} from "@/lib/cn";
import {ArrowUpRightIcon} from "../ui/Icons";
import {LaunchpadMark} from "../LaunchpadMark";

/**
 * The stat block a token trader actually reads before sizing: depth first,
 * then supply, then age. Market cap is last because it is the number that is
 * already at the top of the page.
 */
export function InfoPanel({token}: {token: TokenAsset}) {
  const supply = token.priceUsd > 0 ? token.marketCapUsd / token.priceUsd : 0;
  // Depth relative to daily flow is the one derived number worth showing: a
  // large cap over a thin pool is the failure mode this page should expose.
  const turnover =
    token.liquidityUsd > 0 ? token.volume24hUsd / token.liquidityUsd : 0;

  return (
    <div className="pb-1">
      <p className="mb-4 text-[13.5px] leading-[1.55] text-muted">
        {token.description}
      </p>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-0 overflow-hidden rounded-panel border border-hairline bg-card">
        <Stat label="Liquidity" value={compactMoney(token.liquidityUsd)} />
        <Stat label="24h volume" value={compactMoney(token.volume24hUsd)} />
        <Stat label="Market cap" value={compactMoney(token.marketCapUsd)} />
        <Stat label="Price" value={fmtPrice(token.priceUsd)} />
        <Stat label="Supply" value={compact(supply)} />
        <Stat label="Holders" value={compact(token.holders)} />
        <Stat
          label="Vol / liq"
          value={turnover > 0 ? `${turnover.toFixed(2)}x` : "—"}
        />
        <Stat
          label="24h change"
          value={percent(token.changePct)}
          tone={token.changePct >= 0 ? "up" : "down"}
        />
      </dl>

      <div className="mt-4 overflow-hidden rounded-panel border border-hairline bg-card">
        <Row label="Pair">
          <span className="tnum text-[13px] font-extrabold">
            {token.symbol} / {token.pairedTicker}
          </span>
        </Row>
        <Row label="Launchpad">
          <a
            href={token.launchpad.tokenUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-[13px] font-extrabold transition-colors hover:text-green-deep"
          >
            <LaunchpadMark launchpad={token.launchpad} size={20} />
            {token.launchpad.name}
            <ArrowUpRightIcon className="h-3.5 w-3.5 text-faint" />
          </a>
        </Row>
        <Row label="Taxes">
          <span className="tnum text-[13px] font-extrabold">
            {token.buyTaxPct === 0 && token.sellTaxPct === 0 ? (
              <span className="text-green-deep">None</span>
            ) : (
              <>
                {token.buyTaxPct}% buy
                <span className="mx-1 font-semibold text-faint">·</span>
                {token.sellTaxPct}% sell
              </>
            )}
          </span>
        </Row>
        <Row label="Contract">
          <a
            href={addressUrlForChain(token.address, RH_MAINNET_ID)}
            target="_blank"
            rel="noopener noreferrer"
            className="tnum flex items-center gap-1.5 text-[13px] font-semibold text-muted transition-colors hover:text-ink"
          >
            {shortAddress(token.address)}
            <ArrowUpRightIcon className="h-3.5 w-3.5" />
          </a>
        </Row>
        <Row label="Deployed">
          <span className="text-[13px] font-semibold text-muted">
            {stamp(token.createdAt)} · {ageSince(token.createdAt)} old
          </span>
        </Row>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
}) {
  return (
    <div className="border-b border-hairline px-4 py-3 last:border-b-0 [&:nth-last-child(-n+2)]:border-b-0">
      <dt className="text-[10.5px] font-bold uppercase tracking-[0.07em] text-faint">
        {label}
      </dt>
      <dd
        className={cn(
          "tnum mt-0.5 text-[15px] font-extrabold tracking-[-0.02em]",
          tone === "up" && "text-green-deep",
          tone === "down" && "text-red",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function Row({label, children}: {label: string; children: React.ReactNode}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3 last:border-b-0">
      <span className="text-[12.5px] font-bold text-faint">{label}</span>
      {children}
    </div>
  );
}
