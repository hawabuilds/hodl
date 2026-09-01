/* eslint-disable @next/next/no-img-element */
import { cn } from "@/lib/cn";

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
  size?: number;
  className?: string;
  ring?: boolean;
}

export function Avatar({
  name,
  src,
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

  if (src) {
    return (
      <img
        src={src}
        alt={name ?? "Profile"}
        style={style}
        className={cn(
          "shrink-0 rounded-full object-cover",
          ring && "shadow-[0_0_0_2px_#fff,0_6px_16px_-8px_rgba(9,24,14,0.4)]",
          className,
        )}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      style={{ ...style, background: gradientFor(name ?? "?") }}
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
