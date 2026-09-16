import type { Image } from "@/types/public";

// Image attribute helpers for ResponsiveImage. Client-safe and pure, so they are unit-tested.

/**
 * `srcset` from an image's pre-generated variants (ADR-012). A URL containing whitespace or a
 * comma would corrupt the list, so such a variant is left out rather than escaped.
 */
export function srcSetOf(image: Image): string | undefined {
  const entries = image.variants
    .filter(({ url, width }) => !/[\s,]/.test(url) && width > 0)
    .map(({ url, width }) => `${url} ${width}w`);
  return entries.length > 0 ? entries.join(", ") : undefined;
}

const BLUR_DATA_URL =
  /^data:image\/(?:webp|png|jpeg|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * The blur placeholder as a CSS `url()`, or null. It is written into a style attribute, so
 * anything but a plain base64 image data URL is refused: no quotes, parentheses or other URLs.
 */
export function blurBackgroundOf(image: Image): string | null {
  const { blurDataUrl } = image;
  if (!blurDataUrl || !BLUR_DATA_URL.test(blurDataUrl)) return null;
  return `url("${blurDataUrl}")`;
}

/** "Ada Lovelace" → "AL", "stripe" → "S", "  " → "?". */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (!first) return "?";
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  const letter = (word: string) =>
    Array.from(word)[0]?.toLocaleUpperCase() ?? "";
  return `${letter(first)}${last ? letter(last) : ""}`;
}
