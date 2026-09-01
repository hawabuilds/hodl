import {cn} from "@/lib/cn";
import type {Launchpad} from "@/lib/types";

/**
 * The launchpad a token was deployed from.
 *
 * Drawn from the launchpad's brand colour and initial rather than a bundled
 * image: there are no logo files to ship until the real integrations exist, and
 * a coloured mark reads as identity where a broken image does not.
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
  return (
    <span
      aria-hidden="true"
      title={launchpad.name}
      style={{
        width: size,
        height: size,
        background: launchpad.color,
        fontSize: Math.round(size * 0.48),
      }}
      className={cn(
        "grid shrink-0 place-items-center rounded-[7px] font-extrabold text-white",
        className,
      )}
    >
      {launchpad.name.slice(0, 1)}
    </span>
  );
}
