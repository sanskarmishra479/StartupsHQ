import { cx } from "@/lib/cx";
import { blurBackgroundOf, srcSetOf } from "@/lib/image";
import type { Image } from "@/types/public";

type ResponsiveImageProps = Readonly<{
  image: Image;
  /** Empty for a decorative image whose meaning is already in nearby text. */
  alt: string;
  /** The rendered width at each breakpoint, so the browser picks the smallest adequate variant. */
  sizes: string;
  fit?: "cover" | "contain";
  /** For the one image that is the page's largest paint; everything else loads lazily. */
  priority?: boolean;
  className?: string;
}>;

/**
 * An <img> over Blob variants (ADR-012: no image optimizer), with the stored blur as its
 * placeholder background until the image paints over it.
 */
export function ResponsiveImage({
  image,
  alt,
  sizes,
  fit = "cover",
  priority = false,
  className,
}: ResponsiveImageProps) {
  const blur = blurBackgroundOf(image);
  return (
    // biome-ignore lint/performance/noImgElement: variants are pre-generated in Blob; next/image would add nothing but its optimizer, which is off (ADR-012).
    <img
      src={image.url}
      srcSet={srcSetOf(image)}
      sizes={sizes}
      alt={alt}
      width={image.width}
      height={image.height}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      className={cx(
        "bg-center bg-cover bg-no-repeat",
        fit === "cover" ? "object-cover" : "object-contain",
        className,
      )}
      style={blur ? { backgroundImage: blur } : undefined}
    />
  );
}
