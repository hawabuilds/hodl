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
      <div
        data-surface="popup"
        className="pointer-events-auto grid grid-cols-2 gap-2 rounded-2xl bg-surface-popup/88 p-2 shadow-panel backdrop-blur-[16px]"
      >
        <button
          type="button"
          onClick={onBuy}
          aria-label={`Buy ${symbol}`}
          className="rounded-2xl bg-[var(--price-up-wash)] py-[13px] text-[15px] font-bold tabular-nums text-price-up shadow-price-up transition-[transform,background-color,box-shadow] duration-150 hover:-translate-y-0.5 hover:bg-[var(--price-up-wash-hover)]"
        >
          Buy
        </button>
        <button
          type="button"
          onClick={onSell}
          aria-label={`Sell ${symbol}`}
          className="rounded-2xl bg-[var(--price-down-wash)] py-[13px] text-[15px] font-bold tabular-nums text-price-down shadow-price-down transition-[transform,background-color,box-shadow] duration-150 hover:-translate-y-0.5 hover:bg-[var(--price-down-wash-hover)]"
        >
          Sell
        </button>
      </div>
    </div>
  );
}
