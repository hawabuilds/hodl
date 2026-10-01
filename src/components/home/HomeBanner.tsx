"use client";

import {useCallback, useEffect, useRef, useState, type TouchEvent} from "react";
import {useRouter} from "next/navigation";
import {cn} from "@/lib/cn";
import {useHomeBanner} from "@/hooks/useHomeBanner";
import {CloseIcon} from "../ui/Icons";
import {HomeBannerArt} from "./HomeBannerArt";
import {HOME_BANNER_ADVANCE_MS, HOME_BANNER_SLIDES} from "./homeBannerSlides";

/** A swipe shorter than this snaps back rather than changing slide. */
const SWIPE_PX = 40;
/** Scrolled further than this, the banner folds away so the list gets the room. */
const FOLD_AT_PX = 24;

/**
 * Mobile Home's swipeable promo banner, between the logo row and the tabs.
 *
 * Slides come from homeBannerSlides. It advances every 5s, holds while a
 * finger is on it, and swipes either way. ✕ closes it for good (see
 * useHomeBanner). It sits in the sticky header, so once the list scrolls it
 * folds away and the header is back to its usual height.
 */
export function HomeBanner({onCreate}: {onCreate: () => void}) {
  const router = useRouter();
  const {open, close} = useHomeBanner();
  const [index, setIndex] = useState(0);
  const [drag, setDrag] = useState(0);
  const [touching, setTouching] = useState(false);
  const [folded, setFolded] = useState(false);
  const startX = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const count = HOME_BANNER_SLIDES.length;

  // Auto-advance, held while touched.
  useEffect(() => {
    if (!open || touching || count < 2) return;
    const id = window.setInterval(() => setIndex((at) => (at + 1) % count), HOME_BANNER_ADVANCE_MS);
    return () => window.clearInterval(id);
  }, [open, touching, count, index]);

  // Fold away once the page scrolls (the scroller is the app shell, not the window).
  useEffect(() => {
    if (!open) return;
    let scroller: HTMLElement | null = rootRef.current?.parentElement ?? null;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    if (!scroller) return;
    const target = scroller;
    const onScroll = () => setFolded(target.scrollTop > FOLD_AT_PX);
    onScroll();
    target.addEventListener("scroll", onScroll, {passive: true});
    return () => target.removeEventListener("scroll", onScroll);
  }, [open]);

  const go = useCallback(
    (action: string) => {
      if (action === "create") onCreate();
      else router.push(action);
    },
    [onCreate, router],
  );

  if (!open) return null;

  const onTouchStart = (event: TouchEvent) => {
    startX.current = event.touches[0]?.clientX ?? null;
    setTouching(true);
  };
  const onTouchMove = (event: TouchEvent) => {
    if (startX.current == null) return;
    setDrag((event.touches[0]?.clientX ?? startX.current) - startX.current);
  };
  const onTouchEnd = () => {
    if (drag <= -SWIPE_PX) setIndex((at) => (at + 1) % count);
    else if (drag >= SWIPE_PX) setIndex((at) => (at - 1 + count) % count);
    startX.current = null;
    setDrag(0);
    setTouching(false);
  };

  return (
    <div
      ref={rootRef}
      className={cn(
        "grid transition-[grid-template-rows,margin] duration-200 ease-out",
        folded ? "-mt-0 grid-rows-[0fr]" : "-mt-1 grid-rows-[1fr]",
      )}
    >
      <div className="min-h-0 overflow-hidden">
        <section aria-roledescription="carousel" aria-label="What's new on HODL" className="pb-3">
          <div
            className="relative overflow-hidden rounded-[18px] bg-[linear-gradient(120deg,#7B6CFF_0%,#5A4FE0_55%,#3F35B8_100%)]"
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchEnd}
          >
            <div
              className={cn("flex", !touching && "transition-transform duration-300 ease-out")}
              style={{transform: `translateX(calc(${-index * 100}% + ${drag}px))`}}
            >
              {HOME_BANNER_SLIDES.map((slide, at) => (
                <div
                  key={slide.id}
                  role="group"
                  aria-roledescription="slide"
                  aria-label={`${at + 1} of ${count}`}
                  aria-hidden={at !== index}
                  className="flex w-full shrink-0 items-center gap-3 py-3.5 pl-4 pr-3"
                >
                  <div className="min-w-0 flex-1">
                    <h2 className="pr-5 text-[15px] font-extrabold leading-[1.2] tracking-[-0.01em] text-white">
                      {slide.title}
                    </h2>
                    <p className="mt-1 text-[12px] font-medium leading-[1.35] text-white/80">{slide.body}</p>
                    <button
                      type="button"
                      tabIndex={at === index ? 0 : -1}
                      onClick={() => go(slide.action)}
                      className="mt-2.5 inline-flex h-[30px] items-center rounded-full bg-white px-3.5 text-[12.5px] font-extrabold text-[#3F35B8] transition-transform active:scale-[0.97]"
                    >
                      {slide.cta}
                    </button>
                  </div>
                  <HomeBannerArt art={slide.art} />
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close banner"
              className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full text-white/80 transition-colors hover:bg-white/15 hover:text-white"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          </div>
          {count > 1 ? (
            <div className="mt-2 flex justify-center gap-1.5" role="tablist" aria-label="Choose a slide">
              {HOME_BANNER_SLIDES.map((slide, at) => (
                <button
                  key={slide.id}
                  type="button"
                  role="tab"
                  aria-selected={at === index}
                  aria-label={`Slide ${at + 1}`}
                  onClick={() => setIndex(at)}
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-200",
                    at === index ? "w-4 bg-brand-500" : "w-1.5 bg-[var(--overlay-wash-hover)]",
                  )}
                />
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
