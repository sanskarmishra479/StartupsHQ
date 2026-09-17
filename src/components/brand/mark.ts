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

/**
 * Fixed colours, never themed: the mark always sits centred on its white square (owner's call,
 * 2026-09-17), inline and in the generated icons alike. Solid is the source file's near-black,
 * tint the middle of its grey gradient.
 */
export const MARK_TONES = {
  tile: "#ffffff",
  solid: "#0d0d0d",
  tint: "#c8c8c8",
} as const;

/** The source file's 200×200 artboard; the drawn shape is centred in it. */
export const MARK_ARTBOARD = 200;

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
