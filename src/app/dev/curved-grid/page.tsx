import type { Metadata } from "next";
import { notFound } from "next/navigation";
import sharp from "sharp";
import type { Image, StartupCard } from "@/types/public";
import { SAMPLE_CARDS } from "../gallery/fixtures";
import { MeasuredGrid } from "./FrameMeter";

// Curved-grid spike (TODO Phase 13): the landing's WebGL grid over 300 fictional cards, with a
// frame meter. Drag, fling, scroll, hover and click; Tab moves through the hidden links. Emulate
// reduced motion to see the flat fallback. Development only — a production build answers 404.

export const metadata: Metadata = {
  title: "Curved grid spike · StartupsHQ",
  robots: { index: false, follow: false },
};

/**
 * Real covers are WebP from Blob, and browsers draw SVG into a canvas inconsistently, so the
 * sample SVGs are rasterised to PNG here to exercise the same path as production images.
 */
async function rasterised(
  image: Image | null,
  width: number,
): Promise<Image | null> {
  if (!image) return null;
  const svg = decodeURIComponent(image.url.slice(image.url.indexOf(",") + 1));
  const height = Math.round((width * image.height) / image.width);
  const png = await sharp(Buffer.from(svg))
    .resize(width, height)
    .png()
    .toBuffer();
  const url = `data:image/png;base64,${png.toString("base64")}`;
  return { url, blurDataUrl: null, width, height, variants: [{ width, url }] };
}

/** The twelve samples repeated to the landing's 300, with distinct names and slugs. */
async function sampleCards(): Promise<StartupCard[]> {
  const samples = await Promise.all(
    SAMPLE_CARDS.map(async (card) => ({
      ...card,
      cover: await rasterised(card.cover, 640),
      logo: await rasterised(card.logo, 64),
    })),
  );
  return Array.from({ length: 300 }, (_, i) => {
    const base = samples[i % samples.length] as StartupCard;
    const copy = Math.floor(i / samples.length);
    return copy === 0
      ? base
      : {
          ...base,
          slug: `${base.slug}-${copy}`,
          name: `${base.name} ${copy + 1}`,
        };
  });
}

export default async function CurvedGridSpikePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main>
      <h1 className="sr-only">Curved grid spike</h1>
      <MeasuredGrid cards={await sampleCards()} />
    </main>
  );
}
