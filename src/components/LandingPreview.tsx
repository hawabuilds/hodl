"use client";

/**
 * An example of the product beside the landing pitch on a desktop.
 *
 * A phone's landing page is the pitch and nothing else, because that is all
 * the screen holds. A desktop has room to show what the pitch is about, so it
 * shows the Tokens table — as a picture. It used to be the live market, which
 * made every signed-out visit wait on a market load before the page looked
 * finished; a still of the table says the same thing at once and fetches
 * nothing. Clicking it asks you to join, since the app is behind sign-in.
 *
 * The frame keeps the live version's size (523px tall, the column's width),
 * and the picture fills it from the top left, so nothing moves as it loads.
 * The picture is public/landing/tokens-table{,@2x}.webp — a 1440-wide capture
 * of the Trending tab, cropped below the top bar.
 */
export function LandingPreview({onJoin}: {onJoin: () => void}) {
  return (
    <div className="relative">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-16 rounded-full bg-[radial-gradient(closest-side,rgb(104_96_255/22%),transparent)]"
      />
      <div className="relative flex h-[523px] flex-col rounded-[20px] border border-[var(--overlay-wash)] bg-[var(--frame-chrome)] p-2.5 shadow-modal">
        <div className="flex items-baseline justify-between gap-3 px-2 pb-2.5 pt-1">
          <span className="text-[13px] font-extrabold tracking-[-0.01em]">Tokens on HODL</span>
          <span className="text-[11.5px] font-semibold text-faint">Example</span>
        </div>
        <button
          type="button"
          onClick={onJoin}
          aria-label="Join HODL"
          className="min-h-0 flex-1 overflow-hidden rounded-[14px] border border-[var(--overlay-wash)] bg-surface-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a pre-sized static still with its own 1x/2x files */}
          <img
            src="/landing/tokens-table.webp"
            srcSet="/landing/tokens-table.webp 1x, /landing/tokens-table@2x.webp 2x"
            width={720}
            height={483}
            alt="Example of the HODL tokens table"
            fetchPriority="high"
            className="h-full w-full object-cover object-left-top"
          />
        </button>
      </div>
    </div>
  );
}
