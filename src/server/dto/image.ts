import "server-only";

import type { MediaVariant } from "../db/schema/media";

// docs/API.md §7.0. Images are served straight from Blob; `url` is the largest variant (ADR-012).

export type Image = Readonly<{
  url: string;
  blurDataUrl: string | null;
  width: number;
  height: number;
  variants: readonly Readonly<{ width: number; url: string }>[];
}>;

export type MediaFields =
  | Readonly<{
      variants: readonly MediaVariant[] | null;
      blurDataUrl: string | null;
    }>
  | null
  | undefined;

/** A media asset as a public Image; null when there is no asset or it has no renditions yet. */
export function toImage(media: MediaFields): Image | null {
  if (!media?.variants?.length) return null;
  const variants = [...media.variants].sort((a, b) => a.width - b.width);
  const largest = variants[variants.length - 1] as MediaVariant;
  return {
    url: largest.url,
    blurDataUrl: media.blurDataUrl,
    width: largest.width,
    height: largest.height,
    variants: variants.map(({ width, url }) => ({ width, url })),
  };
}
