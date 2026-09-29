"use client";

import {useEffect} from "react";

/**
 * "Open the launch sheet", from anywhere.
 *
 * On a phone the sheet belongs to Home, whose header carries the button. On
 * desktop the button is in the top bar and has to work from a token page too,
 * so the sheet is mounted once by the desktop shell and opened by this event —
 * the same pattern `requestPushIntent` uses.
 *
 * The pending flag exists because of effect order. `/create` redirects to
 * `/home?create=1`, and Home reads that flag in its own effect — but React runs
 * a child's effects before its parent's, so Home fires the request before the
 * shell above it has started listening. Without the flag that first request is
 * dropped and the redirect opens nothing. The shell consumes it on mount.
 */

const EVENT = "hodl:create-intent";
let pending = false;

export function requestCreate(): void {
  if (typeof window === "undefined") return;
  pending = true;
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function useCreateIntent(onOpen: () => void): void {
  useEffect(() => {
    const open = () => {
      pending = false;
      onOpen();
    };
    if (pending) open();
    window.addEventListener(EVENT, open);
    return () => window.removeEventListener(EVENT, open);
  }, [onOpen]);
}
