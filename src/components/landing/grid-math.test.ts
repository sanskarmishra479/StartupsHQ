import { describe, expect, it } from "vitest";
import {
  CELL_ASPECT,
  cardIndexAt,
  cellAtPointer,
  columnsFor,
  Inertia,
  layoutFor,
  screenToTarget,
  targetSize,
  visibleCells,
} from "./grid-math";

describe("layout", () => {
  it.each([
    [360, 2],
    [768, 3],
    [1024, 4],
    [1440, 5],
    [2560, 6],
  ])("shows %i px wide screens %i columns at the centre", (width, columns) => {
    expect(columnsFor(width)).toBe(columns);
  });

  it("sizes cells in device pixels at the card aspect", () => {
    const layout = layoutFor(390, 2, 300);
    expect(layout.cellWidth).toBe(390);
    expect(layout.cellHeight).toBeCloseTo(390 * CELL_ASPECT);
  });

  it("tiles every card exactly once per tile, in a roughly square tile", () => {
    const layout = layoutFor(1440, 1, 300);
    const seen = new Set<number>();
    for (let row = 0; row < layout.tileRows; row++) {
      for (let column = 0; column < layout.tileColumns; column++) {
        seen.add(cardIndexAt(layout, column, row));
      }
    }
    expect(seen.size).toBe(300);
    const tileAspect =
      (layout.tileColumns * layout.cellWidth) /
      (layout.tileRows * layout.cellHeight);
    expect(tileAspect).toBeGreaterThan(0.8);
    expect(tileAspect).toBeLessThan(1.25);
  });

  it("wraps endlessly in every direction, negative cells included", () => {
    const layout = layoutFor(1440, 1, 300);
    const { tileColumns: c, tileRows: r } = layout;
    expect(cardIndexAt(layout, 3, 4)).toBe(cardIndexAt(layout, 3 + c, 4));
    expect(cardIndexAt(layout, 3, 4)).toBe(
      cardIndexAt(layout, 3 - 5 * c, 4 + 7 * r),
    );
    expect(cardIndexAt(layout, -1, -1)).toBeGreaterThanOrEqual(0);
  });

  it("copes with a set smaller than one row, or empty", () => {
    expect(cardIndexAt(layoutFor(1440, 1, 1), 5, -9)).toBe(0);
    expect(layoutFor(1440, 1, 0).count).toBe(1);
  });
});

describe("visibleCells", () => {
  it("covers the whole target with no gaps", () => {
    const layout = layoutFor(1280, 1, 300);
    const target = { width: 1500, height: 900 };
    const cells = visibleCells(layout, { x: -123.4, y: 5678.9 }, target);
    const left = Math.min(...cells.map((c) => c.x));
    const top = Math.min(...cells.map((c) => c.y));
    const right = Math.max(...cells.map((c) => c.x + layout.cellWidth));
    const bottom = Math.max(...cells.map((c) => c.y + layout.cellHeight));
    expect(left).toBeLessThanOrEqual(0);
    expect(top).toBeLessThanOrEqual(0);
    expect(right).toBeGreaterThanOrEqual(target.width);
    expect(bottom).toBeGreaterThanOrEqual(target.height);
    // And nothing wholly outside it.
    for (const cell of cells) {
      expect(cell.x).toBeLessThan(target.width);
      expect(cell.y).toBeLessThan(target.height);
    }
  });
});

describe("the curve", () => {
  it("keeps the centre fixed and at 1:1 scale", () => {
    const strength = 0.2;
    expect(screenToTarget(0, 0, 16 / 9, strength)).toEqual([0, 0]);
    const [x] = screenToTarget(0.001, 0, 16 / 9, strength);
    // Target units are (1 + strength) times larger, so 1:1 in pixels is 1/(1+strength) in units.
    expect(x / 0.001).toBeCloseTo(1 / (1 + strength), 3);
  });

  it("maps the corners of the screen onto the corners of the target", () => {
    const [x, y] = screenToTarget(1, -1, 16 / 9, 0.2);
    expect(x).toBeCloseTo(1);
    expect(y).toBeCloseTo(-1);
  });

  it("stays inside a target sized for a stronger curve", () => {
    const [x, y] = screenToTarget(1, 1, 16 / 9, 0.2, 0.3);
    expect(x).toBeLessThan(1);
    expect(y).toBeLessThan(1);
    expect(screenToTarget(0.001, 0, 1, 0.2, 0.3)[0] / 0.001).toBeCloseTo(
      1 / 1.3,
      3,
    );
  });

  it("compresses towards the edges and never folds back", () => {
    let previous = -Infinity;
    for (let n = 0; n <= 1; n += 0.05) {
      const [x] = screenToTarget(n, 0, 1, 0.25);
      expect(x).toBeGreaterThan(previous);
      previous = x;
    }
  });
});

describe("cellAtPointer", () => {
  it("finds the cell under the centre of the screen", () => {
    const layout = layoutFor(1280, 2, 300);
    const canvas = { width: 1280, height: 720 };
    const camera = {
      x: 7.5 * layout.cellWidth,
      y: -2.5 * layout.cellHeight,
    };
    expect(
      cellAtPointer(layout, camera, canvas, 2, 0.2, { x: 640, y: 360 }),
    ).toEqual({ column: 7, row: -3 });
  });

  it("agrees with the flat grid when there is no curve", () => {
    const layout = layoutFor(1280, 1, 300);
    const canvas = { width: 1280, height: 720 };
    const camera = { x: 640, y: 360 };
    // With the camera centred on the canvas, CSS and world pixels coincide.
    expect(
      cellAtPointer(layout, camera, canvas, 1, 0, {
        x: layout.cellWidth * 2.5,
        y: layout.cellHeight * 1.5,
      }),
    ).toEqual({ column: 2, row: 1 });
  });

  it("sizes the target from CSS pixels, pixel ratio and strength", () => {
    expect(targetSize({ width: 390, height: 844 }, 2, 0.2)).toEqual({
      width: 936,
      height: 2026,
    });
  });
});

describe("Inertia", () => {
  it("coasts after a fling and comes to rest", () => {
    const inertia = new Inertia(0.3);
    inertia.sample(0, 0, 1000);
    for (let t = 1016; t <= 1100; t += 16) inertia.sample(-20, 0, t);
    inertia.release(1100);
    expect(inertia.moving).toBe(true);
    let travelled = 0;
    for (let i = 0; i < 400 && inertia.moving; i++) {
      travelled += inertia.step(1 / 60)[0];
    }
    expect(travelled).toBeLessThan(0);
    expect(inertia.moving).toBe(false);
  });

  it("does not coast when the pointer stopped before release", () => {
    const inertia = new Inertia();
    inertia.sample(-30, 0, 1000);
    inertia.sample(-30, 0, 1016);
    inertia.release(1300);
    expect(inertia.moving).toBe(false);
  });
});
