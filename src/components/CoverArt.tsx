import {cn} from "@/lib/cn";

/**
 * Artwork for a story.
 *
 * There are no photographs to ship and no image host to fetch from, and a grey
 * box where a news app puts a picture reads as broken. This draws a stable
 * abstract mark instead: two hues seeded off the story id, a pair of soft
 * blooms, and the ticker set into the corner when there is one.
 *
 * Deterministic, so a story keeps its artwork between renders and across the
 * hero and list treatments of the same item.
 *
 * When a real headline provider lands it will carry image URLs; this stays as
 * the fallback for the many stories that have none.
 */
function hue(seed: string, offset: number): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h + offset) % 360;
}

export function CoverArt({
  seed,
  label,
  /** Robinhood stories share one family so the section reads as a set. */
  brand = false,
  className,
  labelClassName,
}: {
  seed: string;
  label?: string;
  brand?: boolean;
  className?: string;
  labelClassName?: string;
}) {
  const base = brand ? 140 : hue(seed, 0);
  const second = brand ? 158 : hue(seed, 97);

  return (
    <div
      aria-hidden="true"
      style={{
        backgroundImage: `radial-gradient(120% 90% at 18% 12%, hsl(${base} 72% 46% / 0.95), transparent 62%),
          radial-gradient(110% 100% at 88% 92%, hsl(${second} 64% 38% / 0.9), transparent 58%),
          linear-gradient(135deg, hsl(${base} 45% 16%), hsl(${second} 52% 9%))`,
      }}
      className={cn("relative overflow-hidden", className)}
    >
      <svg
        viewBox="0 0 200 200"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full opacity-[0.22]"
      >
        <circle cx="42" cy="150" r="70" fill="white" opacity="0.35" />
        <circle cx="168" cy="44" r="52" fill="white" opacity="0.2" />
        <path
          d="M0 168 C 60 120, 140 190, 200 128"
          stroke="white"
          strokeWidth="1.5"
          fill="none"
          opacity="0.5"
        />
      </svg>

      {label ? (
        <span
          className={cn(
            "absolute bottom-1.5 right-2 font-extrabold uppercase tracking-[0.06em] text-white/80",
            labelClassName ?? "text-[10px]",
          )}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
}
