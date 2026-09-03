/* eslint-disable @next/next/no-img-element */
"use client";

import {useState} from "react";
import {cn} from "@/lib/cn";

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
  /** Shown when `src` is missing or fails to load — e.g. launchpad logo. */
  fallbackSrc?: string | null;
  size?: number;
  className?: string;
  ring?: boolean;
}

export function Avatar({
  name,
  src,
  fallbackSrc,
  size = 40,
  className,
  ring = false,
}: AvatarProps) {
  const initial = (name?.trim()?.[0] ?? "?").toUpperCase();
  const style: React.CSSProperties = {
    width: size,
    height: size,
    fontSize: Math.round(size * 0.38),
  };
  const [failedPrimary, setFailedPrimary] = useState(false);
  const [failedFallback, setFailedFallback] = useState(false);

  const imgClass = cn(
    "shrink-0 rounded-full object-cover",
    ring && "shadow-[0_0_0_2px_#fff,0_6px_16px_-8px_rgba(9,24,14,0.4)]",
    className,
  );

  if (src && !failedPrimary) {
    return (
      <img
        src={src}
        alt={name ?? "Profile"}
        style={style}
        className={imgClass}
        onError={() => setFailedPrimary(true)}
      />
    );
  }

  if (fallbackSrc && !failedFallback) {
    return (
      <img
        src={fallbackSrc}
        alt={name ?? "Profile"}
        style={style}
        className={imgClass}
        onError={() => setFailedFallback(true)}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      style={{...style, background: gradientFor(name ?? "?")}}
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-extrabold text-white",
        ring && "shadow-[0_0_0_2px_#fff,0_6px_16px_-8px_rgba(9,24,14,0.4)]",
        className,
      )}
    >
      {initial}
    </span>
  );
}
