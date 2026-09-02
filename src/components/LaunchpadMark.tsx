import Image from "next/image";
import {cn} from "@/lib/cn";
import type {Launchpad} from "@/lib/types";

/**
 * The launchpad a token was deployed from.
 *
 * Uses the launchpad's own brand mark where one is bundled, and falls back to
 * its colour and initial where none is — a launchpad added without an asset
 * still renders as identity rather than as a broken image.
 *
 * The marks ship with an opaque background, so the tile is rounded and clipped
 * rather than laid straight onto the page.
 */
export function LaunchpadMark({
  launchpad,
  size = 24,
  className,
}: {
  launchpad: Launchpad;
  size?: number;
  className?: string;
}) {
  const radius = Math.max(5, Math.round(size * 0.29));

  if (launchpad.logoUrl) {
    const vector = launchpad.logoUrl.endsWith(".svg");

    return (
      <Image
        src={launchpad.logoUrl}
        alt={`${launchpad.name} logo`}
        // Raster marks are asked for at three times the drawn size: they are
        // detailed — the Pons one is a glassy letterform — and a 16px source
        // rendered as an unreadable smudge on the chip. A vector needs none of
        // that, and the image optimiser refuses SVG unless the app opts in
        // globally, so it is passed through untouched instead.
        width={vector ? size : size * 3}
        height={vector ? size : size * 3}
        unoptimized={vector}
        style={{width: size, height: size, borderRadius: vector ? 0 : radius}}
        className={cn(
          "shrink-0 object-contain",
          // A raster mark is an opaque square that would otherwise dissolve
          // into a light card, so it gets a rounded tile and an edge. A vector
          // brings its own silhouette — Long's is a circle — and boxing it in
          // a rounded square draws a border that is not part of the logo.
          vector ? null : "border border-hairline object-cover",
          className,
        )}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      title={launchpad.name}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: launchpad.color,
        fontSize: Math.round(size * 0.48),
      }}
      className={cn(
        "grid shrink-0 place-items-center font-extrabold text-white",
        className,
      )}
    >
      {launchpad.name.slice(0, 1)}
    </span>
  );
}
