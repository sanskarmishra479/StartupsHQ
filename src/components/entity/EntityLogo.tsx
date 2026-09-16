import { cx } from "@/lib/cx";
import type { Image } from "@/types/public";
import { InitialsAvatar } from "../media/InitialsAvatar";
import { ResponsiveImage } from "../media/ResponsiveImage";

type EntityLogoProps = Readonly<{
  name: string;
  image: Image | null;
  /** Rendered size in CSS pixels, for choosing a variant. */
  size: number;
  shape?: "square" | "circle";
  /** Hidden from assistive technology when the name is written beside it. */
  decorative?: boolean;
  className?: string;
}>;

/** A logo or photo, or initials on a neutral tile when there is none. */
export function EntityLogo({
  name,
  image,
  size,
  shape = "square",
  decorative = true,
  className,
}: EntityLogoProps) {
  const rounded = shape === "circle" ? "rounded-pill" : "rounded-md";
  if (image) {
    return (
      <ResponsiveImage
        image={image}
        alt={decorative ? "" : name}
        sizes={`${size}px`}
        fit={shape === "circle" ? "cover" : "contain"}
        className={cx(
          "shrink-0 border border-border bg-placeholder",
          rounded,
          className,
        )}
      />
    );
  }
  return (
    <InitialsAvatar
      name={name}
      decorative={decorative}
      shape={shape === "circle" ? "circle" : "square"}
      className={cx(rounded, className)}
    />
  );
}
