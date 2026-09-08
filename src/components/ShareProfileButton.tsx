"use client";

import {useState} from "react";
import {APP_NAME} from "@/config/app";
import {cn} from "@/lib/cn";
import {profileShareUrl} from "@/lib/routes";
import {CheckIcon, ShareIcon} from "./ui/Icons";

/**
 * Share a public `/u/[handle]` link.
 *
 * Uses the OS share sheet when the browser offers one; otherwise copies the
 * URL and flashes a check — same copied-state pattern as wallet / contract.
 */
export function ShareProfileButton({
  handle,
  title,
  className,
}: {
  handle: string;
  title?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  if (!handle) return null;

  async function share() {
    const url = profileShareUrl(handle);
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: title ? `${title} on ${APP_NAME}` : `@${handle} on ${APP_NAME}`,
          url,
        });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void share()}
      aria-label={copied ? "Copied" : "Share profile"}
      title={copied ? "Copied" : "Share profile"}
      className={cn(
        "grid h-9 w-9 place-items-center rounded-full transition-colors",
        copied
          ? "text-green-deep"
          : "text-muted hover:bg-[var(--overlay-wash)] hover:text-ink",
        className,
      )}
    >
      {copied ? (
        <CheckIcon className="h-[19px] w-[19px]" />
      ) : (
        <ShareIcon className="h-[19px] w-[19px]" />
      )}
    </button>
  );
}
