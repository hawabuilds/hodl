"use client";

/**
 * The buy and sell pair, pinned above the tab bar on a chart page.
 *
 * Floating rather than inline because the page scrolls a long way — trades,
 * comments and info all live below the fold, and the action should not scroll
 * away from someone reading them.
 */
export function TradeBar({
  onBuy,
  onSell,
  symbol,
}: {
  onBuy: () => void;
  onSell: () => void;
  symbol: string;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[calc(84px+env(safe-area-inset-bottom))] z-30 px-[22px]">
      <div className="pointer-events-auto grid grid-cols-2 gap-2.5 rounded-[19px] border border-hairline bg-card/92 p-2 shadow-panel backdrop-blur-[16px]">
        <button
          type="button"
          onClick={onBuy}
          aria-label={`Buy ${symbol}`}
          className="rounded-[14px] bg-green py-[13px] text-[15px] font-extrabold text-white shadow-green transition-transform duration-150 hover:-translate-y-0.5"
        >
          Buy
        </button>
        <button
          type="button"
          onClick={onSell}
          aria-label={`Sell ${symbol}`}
          className="rounded-[14px] bg-red py-[13px] text-[15px] font-extrabold text-white transition-transform duration-150 hover:-translate-y-0.5"
        >
          Sell
        </button>
      </div>
    </div>
  );
}
