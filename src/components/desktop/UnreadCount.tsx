"use client";

import {usePulse, type PulseTarget} from "@/lib/alertBus";
import {cn} from "@/lib/cn";

/**
 * A small red count, on the Following tab and the bell. It pulses when a
 * pop-up for it appears, so the pop-up and the count read as one thing.
 */
export function UnreadCount({
  count,
  target,
  className,
}: {
  count: number;
  target: PulseTarget;
  className?: string;
}) {
  const beat = usePulse(target);
  if (count <= 0) return null;
  return (
    <span
      // A new key restarts the animation on every pulse.
      key={beat}
      aria-label={`${count} unread`}
      className={cn(
        "inline-grid h-4 min-w-4 place-items-center rounded-full bg-error px-1 text-[10px] font-extrabold leading-none text-white tabular-nums",
        beat > 0 && "alert-pulse",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
