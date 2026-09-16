// The StartupsHQ mark: two pill rows, each half solid and half grey. Geometry transcribed from the
// owner's source file (public/brand/startupshq-icon.svg) with its metadata left behind, so the
// inline logo and the generated icons (scripts/brand-icons.ts) draw exactly the same shape.

export type Rect = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
}>;

export type MarkPart = Readonly<{
  tone: "solid" | "tint";
  rects: readonly Rect[];
}>;

/** The source file's 200×200 artboard. */
export const MARK_ARTBOARD = 200;

/** Tight bounds of the drawn shape inside the artboard, for inline use without the padding. */
export const MARK_VIEWBOX = "24 37 152 127";

/**
 * In paint order, which matters: each half overlaps its neighbour, and the later one covers the
 * seam. Tones must therefore be opaque. Each half is a pill plus a squarer rect on its inner edge.
 */
export const MARK_PARTS: readonly MarkPart[] = [
  {
    tone: "solid",
    rects: [
      { x: 44, y: 37, width: 74, height: 62, rx: 31 },
      { x: 80, y: 37, width: 38, height: 62, rx: 8 },
    ],
  },
  {
    tone: "tint",
    rects: [
      { x: 102, y: 37, width: 74, height: 62, rx: 31 },
      { x: 102, y: 37, width: 44, height: 62, rx: 14 },
    ],
  },
  {
    tone: "tint",
    rects: [
      { x: 24, y: 102, width: 74, height: 62, rx: 31 },
      { x: 60, y: 102, width: 38, height: 62, rx: 8 },
    ],
  },
  {
    tone: "solid",
    rects: [
      { x: 82, y: 102, width: 74, height: 62, rx: 31 },
      { x: 82, y: 102, width: 44, height: 62, rx: 14 },
    ],
  },
];
