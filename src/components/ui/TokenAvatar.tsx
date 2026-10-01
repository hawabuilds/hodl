import type {ComponentProps} from "react";
import {cn} from "@/lib/cn";
import type {Launchpad} from "@/lib/types";
import {LaunchpadMark} from "../LaunchpadMark";
import {Avatar} from "./Avatar";

/**
 * A token's picture with the launchpad it came from in the bottom-right corner
 * — the desktop Tokens table's mark, used everywhere a token picture appears.
 *
 * Sized from the picture: at the table's 40px the badge is 18px, sits 3px
 * outside the corner and has a 2px ring in the page colour. Smaller pictures
 * scale all three down together. A token whose launchpad is unknown gets no
 * badge at all, never a placeholder.
 */
export function TokenAvatar({
  launchpad,
  size = 40,
  // A surface other than the page (a popup) sets --avatar-ring on itself.
  ringColor = "var(--avatar-ring, var(--surface-base))",
  wrapperClassName,
  ...avatar
}: ComponentProps<typeof Avatar> & {
  launchpad?: Launchpad | null;
  /** The colour behind the picture, so the ring reads as a cut-out. */
  ringColor?: string;
  wrapperClassName?: string;
}) {
  const badge = Math.max(10, Math.round(size * 0.45));
  const offset = Math.round(size * 0.075);
  const ring = size >= 32 ? 2 : 1.5;
  return (
    <span className={cn("relative inline-flex shrink-0", wrapperClassName)}>
      <Avatar size={size} {...avatar} />
      {launchpad ? (
        <span
          title={`Launched on ${launchpad.name}`}
          className="absolute rounded-full"
          style={{right: -offset, bottom: -offset, boxShadow: `0 0 0 ${ring}px ${ringColor}`}}
        >
          <LaunchpadMark launchpad={launchpad} size={badge} className="!rounded-full" />
        </span>
      ) : null}
    </span>
  );
}
