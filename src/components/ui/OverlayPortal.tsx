"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const OVERLAY_ROOT_ID = "app-overlays";

/**
 * Overlays render inside the phone frame rather than on `document.body`, so the
 * desktop device mockup keeps its rounded edges and the backdrop stays contained.
 */
export function OverlayPortal({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHost(document.getElementById(OVERLAY_ROOT_ID));
  }, []);

  if (!host) return null;
  return createPortal(children, host);
}
