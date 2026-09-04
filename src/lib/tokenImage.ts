/**
 * Token PFP resolution. Stored WebP first, then the remote URL the
 * indexer already saved, then a generated mark from the address.
 *
 * A slow logo is acceptable. An empty circle is not.
 */

const STORAGE_MARK = "/storage/v1/object/public/token-images/";

export function isStoredImage(url: string | null | undefined): boolean {
  return Boolean(url && url.includes(STORAGE_MARK));
}

function isBrandLogo(url: string): boolean {
  return (
    /\/launchpads\/(pons|long)/i.test(url) ||
    /pons\.jpg|pons\.png|long\.svg/i.test(url) ||
    /ponsfamily\.com\/.*(favicon|og[-_]?image|logo)/i.test(url) ||
    /long\.xyz\/.*(favicon|og[-_]?image|logo)/i.test(url)
  );
}

/** Remote artwork the client may paint. Brand marks and empty SVGs stay out. */
export function usableRemoteImage(url: string | null | undefined): string | null {
  const value = url?.trim();
  if (!value) return null;
  if (value.startsWith("data:image/svg+xml")) return null;
  if (isBrandLogo(value)) return null;
  if (/missing|placeholder|default/i.test(value) && !value.startsWith("data:")) {
    return null;
  }
  return value;
}

export interface TokenImageRow {
  address?: string | null;
  image_128?: string | null;
  image_64?: string | null;
  image_url?: string | null;
}

/**
 * Ordered sources for one token. First hit is what the row shows; the rest
 * are onError fallbacks. The generated placeholder is appended by Avatar.
 */
export function tokenImageCandidates(row: TokenImageRow): string[] {
  const out: string[] = [];
  const push = (url: string | null | undefined) => {
    if (!url || out.includes(url)) return;
    out.push(url);
  };
  if (isStoredImage(row.image_64)) push(row.image_64);
  if (isStoredImage(row.image_128)) push(row.image_128);
  if (isStoredImage(row.image_url)) push(row.image_url);
  push(usableRemoteImage(row.image_url));
  return out;
}

export function feedImageUrl(row: TokenImageRow): string | null {
  return tokenImageCandidates(row)[0] ?? null;
}

export function hexColor(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : null;
}

function colorFromSeed(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const palette = ["#00C805", "#7C5CFF", "#FF8A3D", "#3DBBFF", "#FF5C93", "#F5C518"];
  return palette[hash % palette.length];
}

/** Last-resort mark so a row never renders an empty circle. */
export function placeholderFromAddress(address: string): string {
  const seed = address.toLowerCase();
  const color = colorFromSeed(seed);
  const letter = (seed[2] ?? "?").toUpperCase();
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="32" fill="${color}"/>` +
    `<text x="32" y="40" text-anchor="middle" font-size="28" font-family="system-ui,sans-serif" font-weight="800" fill="#fff">${letter}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
