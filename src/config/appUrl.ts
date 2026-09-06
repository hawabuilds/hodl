import {APP_DOMAIN} from "./app";

/**
 * Canonical HTTPS origin for metadata, OG crawlers, and Railway cron targets.
 * Set NEXT_PUBLIC_APP_URL on Vercel (e.g. https://hodl.fan).
 */
export function appOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;
  return `https://${APP_DOMAIN}`;
}

export function linkPreviewUserAgent(): string {
  return `Mozilla/5.0 (compatible; HODL-link-preview/1.0; +${appOrigin()}) facebookexternalhit/1.1`;
}
