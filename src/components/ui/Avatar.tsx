/* eslint-disable @next/next/no-img-element */
"use client";

import {useEffect, useMemo, useState} from "react";
import {cn} from "@/lib/cn";
import {loadedLogoFor, rememberLoadedLogo} from "@/lib/tokenLogoCache";

const GRADIENTS = [
  "linear-gradient(135deg,#00C805,#0B7A3C)",
  "linear-gradient(135deg,#7C5CFF,#3D2BA8)",
  "linear-gradient(135deg,#FF8A3D,#C24A12)",
  "linear-gradient(135deg,#3DBBFF,#1465B8)",
  "linear-gradient(135deg,#FF5C93,#B01253)",
  "linear-gradient(135deg,#F5C518,#B8860B)",
];

/** Stable colour per user so avatars do not reshuffle between renders. */
export function gradientFor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return GRADIENTS[hash % GRADIENTS.length];
}

interface AvatarProps {
  name?: string | null;
  src?: string | null;
  src64?: string | null;
  /** Average colour painted immediately so the circle is never empty. */
  color?: string | null;
  /** Shown when `src` is missing or fails to load — e.g. launchpad logo. */
  fallbackSrc?: string | null;
  /** Extra URLs tried in order after src/src64/fallbackSrc fail. */
  fallbacks?: string[] | null;
  /** Token address — used to generate a last-resort mark. */
  seed?: string | null;
  size?: number;
  className?: string;
  ring?: boolean;
  /** Preload the image for feed rows where many avatars appear at once. */
  eager?: boolean;
}

export function Avatar({
  name,
  src,
  src64,
  color,
  fallbackSrc,
  fallbacks,
  seed,
  size = 40,
  className,
  ring = false,
  eager = false,
}: AvatarProps) {
  const sessionUrl = seed ? loadedLogoFor(seed) : null;
  const initial = (name?.trim()?.[0] ?? "?").toUpperCase();
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState<string | null>(sessionUrl);
  const [loaded, setLoaded] = useState(() => Boolean(sessionUrl));
  const [exhausted, setExhausted] = useState(false);

  const chain = useMemo(() => {
    const urls: string[] = [];
    const push = (url: string | null | undefined) => {
      if (!url || urls.includes(url)) return;
      urls.push(url);
    };
    // Session-held first so a decorate miss cannot replace a decoded logo.
    push(held ?? sessionUrl);
    if (size <= 64) {
      push(src64);
      push(src);
    } else {
      push(src);
      push(src64);
    }
    push(fallbackSrc);
    for (const url of fallbacks ?? []) push(url);
    return urls;
  }, [held, sessionUrl, src, src64, fallbackSrc, fallbacks, size]);

  useEffect(() => {
    setIndex(0);
    setExhausted(false);
  }, [chain]);

  const shown =
    chain.length > 0 ? chain[Math.min(index, chain.length - 1)] : held;
  const more = index < chain.length - 1;
  const knownUrl = Boolean(shown);

  return (
    <span
      aria-hidden={!name}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        background: color || gradientFor(seed ?? name ?? "?"),
      }}
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-full font-extrabold text-white",
        ring && "shadow-[0_0_0_2px_#fff,0_6px_16px_-8px_rgba(9,24,14,0.4)]",
        className,
      )}
    >
      {shown && !exhausted && (loaded || knownUrl) ? null : initial}
      {shown && !exhausted ? (
        <img
          src={shown}
          alt={name ?? ""}
          width={size}
          height={size}
          className={cn(
            "absolute inset-0 h-full w-full object-cover",
            // A known URL paints immediately. Opacity-0 until onLoad was the
            // flash: remount looked like a placeholder while the browser
            // already had the bytes.
            knownUrl || loaded ? "opacity-100" : "opacity-0",
          )}
          loading={eager ? "eager" : "lazy"}
          fetchPriority={eager ? "high" : "low"}
          decoding="async"
          onLoad={() => {
            setLoaded(true);
            if (shown) {
              setHeld(shown);
              if (seed) rememberLoadedLogo(seed, shown);
            }
          }}
          onError={() => {
            if (more) {
              setLoaded(false);
              setIndex((current) => current + 1);
              return;
            }
            if (held) {
              setLoaded(true);
              return;
            }
            setExhausted(true);
          }}
        />
      ) : null}
    </span>
  );
}
