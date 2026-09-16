// Geometry of the curved, endlessly wrapping landing grid (TODO Phase 13 spike, ADR-023). Pure and
// DOM-free, so layout, wrapping, hit-testing and inertia are unit-tested apart from WebGL.
//
// Units are device pixels of the offscreen render target ("world" pixels). The grid is drawn flat
// into a target larger than the canvas by `1 + strength`, and a post pass bends it onto the screen:
// the centre keeps 1:1 scale and the edges are compressed, like the reference's barrel curve.

/**
 * A card cell's height over its width, matching EntityCard at 320 px: 12 px padding, a 20 px
 * header, 12 px gaps, the 1.91:1 cover and a 20 px footer. card-raster.ts draws to the same plan.
 */
export const CELL_ASPECT = (88 + (320 - 24) / 1.91) / 320;

export type GridLayout = Readonly<{
  /** Cell size in world pixels. */
  cellWidth: number;
  cellHeight: number;
  /** The repeating tile of cards, in cells. */
  tileColumns: number;
  tileRows: number;
  count: number;
}>;

/** About 2 columns on a phone, 3–4 on a tablet, 5–6 on a desktop, measured at the screen centre. */
export function columnsFor(cssWidth: number): number {
  if (cssWidth < 640) return 2;
  if (cssWidth < 900) return 3;
  if (cssWidth < 1280) return 4;
  if (cssWidth < 1920) return 5;
  return 6;
}

export function layoutFor(
  cssWidth: number,
  devicePixelRatio: number,
  count: number,
): GridLayout {
  const cellWidth = (cssWidth * devicePixelRatio) / columnsFor(cssWidth);
  const cellHeight = cellWidth * CELL_ASPECT;
  const safeCount = Math.max(1, count);
  // A roughly square tile, so repeats are as far apart across as down.
  const tileColumns = Math.max(
    1,
    Math.ceil(Math.sqrt((safeCount * cellHeight) / cellWidth)),
  );
  const tileRows = Math.ceil(safeCount / tileColumns);
  return { cellWidth, cellHeight, tileColumns, tileRows, count: safeCount };
}

const mod = (n: number, m: number) => ((n % m) + m) % m;

/** Which card a cell shows. Cells past the end of a short last row repeat from the start. */
export function cardIndexAt(
  layout: GridLayout,
  column: number,
  row: number,
): number {
  const index =
    mod(row, layout.tileRows) * layout.tileColumns +
    mod(column, layout.tileColumns);
  return index % layout.count;
}

export type Camera = Readonly<{ x: number; y: number }>;
export type Size = Readonly<{ width: number; height: number }>;

export type VisibleCell = Readonly<{
  column: number;
  row: number;
  /** Top-left corner in render-target pixels. */
  x: number;
  y: number;
}>;

/** Every cell that overlaps a render target of `target` size centred on `camera`. */
export function visibleCells(
  layout: GridLayout,
  camera: Camera,
  target: Size,
): VisibleCell[] {
  const left = camera.x - target.width / 2;
  const top = camera.y - target.height / 2;
  const firstColumn = Math.floor(left / layout.cellWidth);
  const lastColumn = Math.floor((left + target.width) / layout.cellWidth);
  const firstRow = Math.floor(top / layout.cellHeight);
  const lastRow = Math.floor((top + target.height) / layout.cellHeight);
  const cells: VisibleCell[] = [];
  for (let row = firstRow; row <= lastRow; row++) {
    for (let column = firstColumn; column <= lastColumn; column++) {
      cells.push({
        column,
        row,
        x: column * layout.cellWidth - left,
        y: row * layout.cellHeight - top,
      });
    }
  }
  return cells;
}

/** How much larger than the canvas the flat render target must be for the curve to fill it. */
export const targetScale = (strength: number) => 1 + strength;

/**
 * The barrel curve: a screen position (−1…1 on both axes, y up) to the render-target position it
 * shows, in the same units. Identical to the fragment shader, which is what makes hit-testing agree
 * with what is drawn. The target is sized for `maxStrength`, so the curve can ease between
 * strengths without reallocating it.
 */
export function screenToTarget(
  nx: number,
  ny: number,
  aspect: number,
  strength: number,
  maxStrength = strength,
): [number, number] {
  const px = nx * aspect;
  const r2 = (px * px + ny * ny) / (aspect * aspect + 1);
  const f = (1 + strength * r2) / targetScale(maxStrength);
  return [nx * f, ny * f];
}

/** The render target for a canvas of `canvas` CSS pixels, in device pixels. */
export function targetSize(
  canvas: Size,
  devicePixelRatio: number,
  strength: number,
): Size {
  const scale = targetScale(strength) * devicePixelRatio;
  return {
    width: Math.round(canvas.width * scale),
    height: Math.round(canvas.height * scale),
  };
}

/** The cell under a pointer, given in CSS pixels from the canvas's top-left corner. */
export function cellAtPointer(
  layout: GridLayout,
  camera: Camera,
  canvas: Size,
  devicePixelRatio: number,
  strength: number,
  pointer: Readonly<{ x: number; y: number }>,
  maxStrength = strength,
): Readonly<{ column: number; row: number }> {
  const nx = (pointer.x / canvas.width) * 2 - 1;
  const ny = 1 - (pointer.y / canvas.height) * 2;
  const [tx, ty] = screenToTarget(
    nx,
    ny,
    canvas.width / canvas.height,
    strength,
    maxStrength,
  );
  const target = targetSize(canvas, devicePixelRatio, maxStrength);
  const worldX = camera.x + (tx * target.width) / 2;
  const worldY = camera.y - (ty * target.height) / 2;
  return {
    column: Math.floor(worldX / layout.cellWidth),
    row: Math.floor(worldY / layout.cellHeight),
  };
}

/**
 * Drag velocity with friction. Samples are smoothed so one jittery pointer event does not fling
 * the grid, and a release after holding still does not coast.
 */
export class Inertia {
  vx = 0;
  vy = 0;
  private lastSample = 0;

  constructor(
    /** Seconds for the speed to fall to 1/e. */
    private readonly decay = 0.35,
  ) {}

  sample(dx: number, dy: number, now: number): void {
    const dt = Math.max(1, now - this.lastSample) / 1000;
    this.lastSample = now;
    const blend = 0.6;
    this.vx = this.vx * (1 - blend) + (dx / dt) * blend;
    this.vy = this.vy * (1 - blend) + (dy / dt) * blend;
  }

  /** At release: a pointer that stopped before letting go carries no momentum. */
  release(now: number): void {
    if (now - this.lastSample > 80) this.stop();
  }

  stop(): void {
    this.vx = 0;
    this.vy = 0;
  }

  /** Distance to travel this frame, slowing the velocity; zero once it is imperceptible. */
  step(dtSeconds: number): [number, number] {
    const dx = this.vx * dtSeconds;
    const dy = this.vy * dtSeconds;
    const friction = Math.exp(-dtSeconds / this.decay);
    this.vx *= friction;
    this.vy *= friction;
    if (Math.hypot(this.vx, this.vy) < 5) this.stop();
    return [dx, dy];
  }

  get moving(): boolean {
    return this.vx !== 0 || this.vy !== 0;
  }
}
