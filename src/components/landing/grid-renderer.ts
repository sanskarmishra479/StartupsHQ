import {
  Geometry,
  Mesh,
  Program,
  Renderer,
  RenderTarget,
  Texture,
  Triangle,
} from "ogl";
import type { StartupCard } from "@/types/public";
import {
  loadImage,
  type RasterTheme,
  rasterCard,
  variantFor,
} from "./card-raster";
import {
  type Camera,
  cardIndexAt,
  cellAtPointer,
  type GridLayout,
  Inertia,
  layoutFor,
  targetSize,
  visibleCells,
} from "./grid-math";

// The curved landing grid (TODO Phase 13 spike, ADR-023). Loaded with a dynamic import only after
// the HTML grid is on screen, and only when motion is allowed, so OGL never blocks first paint.
//
// Each frame: the cells overlapping the render target are drawn flat in one instanced call, each
// sampling its card from a texture atlas; a full-screen pass then bends that image onto the canvas.
// Cards are rasterised into the atlas only when they come into view, so a 300-card set costs about
// one screenful of textures. Nothing renders while the grid is at rest.

const STRENGTH = 0.22;
/** A little more curve while dragging, easing back at rest. */
const STRENGTH_DRAGGING = 0.3;
const MAX_DPR = 2;
const DRAG_THRESHOLD_PX = 6;
const MAX_INSTANCES = 512;

export type GridRendererOptions = Readonly<{
  canvas: HTMLCanvasElement;
  cards: readonly StartupCard[];
  onNavigate: (card: StartupCard) => void;
  onHover?: (card: StartupCard | null) => void;
  /** Called once, after the first frame has been drawn. */
  onReady: () => void;
  /** WebGL unavailable or lost: the caller shows the flat grid instead. */
  onFail: (reason: string) => void;
  onFrame?: (milliseconds: number) => void;
}>;

export type GridRenderer = Readonly<{
  /** Glide to the nearest copy of a card and ring it, for keyboard focus on the hidden links. */
  focusCard: (index: number | null) => void;
  dispose: () => void;
}>;

const GRID_VERTEX = /* glsl */ `
attribute vec2 position;
attribute vec4 aRect;
attribute vec4 aUv;
attribute vec2 aState;
varying vec2 vUv;
varying vec2 vLocal;
varying vec2 vState;
void main() {
  vLocal = position;
  vUv = mix(aUv.xy, aUv.zw, position);
  vState = aState;
  gl_Position = vec4(aRect.x + position.x * aRect.z, aRect.y - position.y * aRect.w, 0.0, 1.0);
}`;

const GRID_FRAGMENT = /* glsl */ `
precision mediump float;
uniform sampler2D tAtlas;
uniform vec3 uBg;
uniform vec3 uHover;
uniform vec3 uRing;
uniform vec2 uRingWidth;
varying vec2 vUv;
varying vec2 vLocal;
varying vec2 vState;
void main() {
  vec4 card = texture2D(tAtlas, vUv);
  vec3 base = mix(uBg, uHover, vState.x);
  vec3 color = mix(base, card.rgb, card.a);
  vec2 edge = min(vLocal, 1.0 - vLocal) / uRingWidth;
  float ring = step(min(edge.x, edge.y), 1.0) * vState.y;
  gl_FragColor = vec4(mix(color, uRing, ring), 1.0);
}`;

const POST_VERTEX = /* glsl */ `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

// Must match screenToTarget in grid-math.ts, which hit-testing relies on.
const POST_FRAGMENT = /* glsl */ `
precision mediump float;
uniform sampler2D tScene;
uniform float uStrength;
uniform float uAspect;
uniform vec3 uBg;
uniform float uGlow;
varying vec2 vUv;
void main() {
  vec2 n = vUv * 2.0 - 1.0;
  vec2 p = vec2(n.x * uAspect, n.y);
  float r2 = dot(p, p) / (uAspect * uAspect + 1.0);
  float f = (1.0 + uStrength * r2) / (1.0 + ${STRENGTH_DRAGGING.toFixed(2)});
  vec3 color = texture2D(tScene, n * f * 0.5 + 0.5).rgb;
  // Edge vignette into the page background, and a soft glow along the top.
  float vignette = smoothstep(1.35, 0.55, length(n * vec2(0.9, 1.0)));
  color = mix(uBg, color, 0.35 + 0.65 * vignette);
  color += vec3(uGlow) * smoothstep(0.7, 1.0, vUv.y);
  gl_FragColor = vec4(color, 1.0);
}`;

function parseColor(value: string): [number, number, number] {
  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) return [0, 0, 0];
  probe.fillStyle = "#000";
  probe.fillStyle = value.trim() || "#000";
  const hex = probe.fillStyle;
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return [0, 0, 0];
  const n = Number.parseInt(match[1] as string, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** A faint light along the top on dark backgrounds; none on light ones, where it would be a smear. */
function glowFor(background: string): number {
  const [r, g, b] = parseColor(background);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5 ? 0.045 : 0;
}

function readTheme(): RasterTheme & {
  bg: string;
  hover: string;
  ring: string;
} {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    bg: token("--bg"),
    hover: token("--surface-hover"),
    ring: token("--focus-ring"),
    fg: token("--fg"),
    fgMuted: token("--fg-muted"),
    border: token("--border"),
    borderStrong: token("--border-strong"),
    placeholder: token("--placeholder"),
    sans: token("--font-geist-sans") || "system-ui, sans-serif",
    mono: token("--font-geist-mono") || "ui-monospace, monospace",
  };
}

/** Which card each atlas slot holds, recycling the slots least recently on screen. */
class Atlas {
  readonly texture: Texture;
  readonly columns: number;
  readonly rows: number;
  private readonly owner: Int32Array;
  private readonly lastSeen: Float64Array;
  private readonly slotOf = new Map<number, number>();

  constructor(
    private readonly gl: Renderer["gl"],
    readonly size: number,
    readonly slotWidth: number,
    readonly slotHeight: number,
  ) {
    this.columns = Math.floor(size / slotWidth);
    this.rows = Math.floor(size / slotHeight);
    this.owner = new Int32Array(this.columns * this.rows).fill(-1);
    this.lastSeen = new Float64Array(this.columns * this.rows).fill(-1);
    this.texture = new Texture(gl, {
      width: size,
      height: size,
      generateMipmaps: false,
      minFilter: gl.LINEAR,
      magFilter: gl.LINEAR,
      flipY: false,
    });
    this.texture.update();
  }

  /** The slot for a card, and whether it still needs painting. */
  acquire(card: number, frame: number): { slot: number; fresh: boolean } {
    const existing = this.slotOf.get(card);
    if (existing !== undefined) {
      this.lastSeen[existing] = frame;
      return { slot: existing, fresh: false };
    }
    let slot = 0;
    for (let i = 1; i < this.lastSeen.length; i++) {
      if ((this.lastSeen[i] as number) < (this.lastSeen[slot] as number))
        slot = i;
    }
    const previous = this.owner[slot] as number;
    if (previous >= 0) this.slotOf.delete(previous);
    this.owner[slot] = card;
    this.lastSeen[slot] = frame;
    this.slotOf.set(card, slot);
    return { slot, fresh: true };
  }

  holds(card: number, slot: number): boolean {
    return this.owner[slot] === card;
  }

  uv(slot: number): [number, number, number, number] {
    const x = (slot % this.columns) * this.slotWidth;
    const y = Math.floor(slot / this.columns) * this.slotHeight;
    return [
      x / this.size,
      y / this.size,
      (x + this.slotWidth) / this.size,
      (y + this.slotHeight) / this.size,
    ];
  }

  paint(slot: number, source: HTMLCanvasElement): void {
    const gl = this.gl;
    this.texture.update();
    gl.renderer.activeTexture(0);
    this.texture.bind();
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.renderer.state.flipY = false;
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.renderer.state.premultiplyAlpha = false;
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      (slot % this.columns) * this.slotWidth,
      Math.floor(slot / this.columns) * this.slotHeight,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      source,
    );
  }

  reset(): void {
    this.owner.fill(-1);
    this.lastSeen.fill(-1);
    this.slotOf.clear();
  }
}

export function createGridRenderer(options: GridRendererOptions): GridRenderer {
  const { canvas, cards } = options;
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

  let renderer: Renderer;
  try {
    renderer = new Renderer({
      canvas,
      dpr,
      alpha: false,
      antialias: false,
      powerPreference: "high-performance",
    });
  } catch {
    options.onFail("no-webgl");
    return { focusCard: () => {}, dispose: () => {} };
  }
  const { gl } = renderer;
  if (!gl) {
    options.onFail("no-webgl");
    return { focusCard: () => {}, dispose: () => {} };
  }

  const maxTexture = Math.min(
    4096,
    gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
  );

  // Geometry: a unit quad, instanced per visible cell.
  const rects = new Float32Array(MAX_INSTANCES * 4);
  const uvs = new Float32Array(MAX_INSTANCES * 4);
  const states = new Float32Array(MAX_INSTANCES * 2);
  const quad = new Geometry(gl, {
    position: {
      size: 2,
      data: new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
    },
    aRect: { instanced: 1, size: 4, data: rects },
    aUv: { instanced: 1, size: 4, data: uvs },
    aState: { instanced: 1, size: 2, data: states },
  });

  let theme = readTheme();
  let atlas: Atlas | null = null;
  const gridProgram = new Program(gl, {
    vertex: GRID_VERTEX,
    fragment: GRID_FRAGMENT,
    // Cells are flipped into clip space (y down), which reverses their winding.
    cullFace: false,
    uniforms: {
      tAtlas: { value: null },
      uBg: { value: parseColor(theme.bg) },
      uHover: { value: parseColor(theme.hover) },
      uRing: { value: parseColor(theme.ring) },
      uRingWidth: { value: [0.01, 0.01] },
    },
    depthTest: false,
    depthWrite: false,
  });
  const gridMesh = new Mesh(gl, {
    geometry: quad,
    program: gridProgram,
    frustumCulled: false,
  });

  let target = new RenderTarget(gl, { width: 1, height: 1, depth: false });
  const postProgram = new Program(gl, {
    vertex: POST_VERTEX,
    fragment: POST_FRAGMENT,
    uniforms: {
      tScene: { value: target.texture },
      uStrength: { value: STRENGTH },
      uAspect: { value: 1 },
      uBg: { value: parseColor(theme.bg) },
      uGlow: { value: glowFor(theme.bg) },
    },
    depthTest: false,
    depthWrite: false,
  });
  const postMesh = new Mesh(gl, {
    geometry: new Triangle(gl),
    program: postProgram,
    frustumCulled: false,
  });

  // State.
  let cssSize = { width: 1, height: 1 };
  let layout: GridLayout = layoutFor(1, dpr, cards.length);
  let targetPx = { width: 1, height: 1 };
  let camera: Camera = { x: 0, y: 0 };
  let strength = STRENGTH;
  let frame = 0;
  let hovered: { column: number; row: number } | null = null;
  let hoverAmount = new Map<string, number>();
  let focusedIndex: number | null = null;
  let tween: { from: Camera; to: Camera; start: number } | null = null;
  const inertia = new Inertia();
  const scratch = document.createElement("canvas");
  const scratchCtx = scratch.getContext("2d");
  let ready = false;
  let raf = 0;
  let lastTime = 0;
  let disposed = false;

  const key = (column: number, row: number) => `${column}:${row}`;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    cssSize = {
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
    };
    renderer.setSize(cssSize.width, cssSize.height);
    // OGL pins the canvas's CSS size in pixels; let the stylesheet size it instead.
    canvas.style.width = "";
    canvas.style.height = "";
    const previousCell = layout.cellWidth;
    layout = layoutFor(cssSize.width, dpr, cards.length);
    // Keep the view centred on the same place in the grid when cells change size.
    if (previousCell > 1) {
      const ratio = layout.cellWidth / previousCell;
      camera = { x: camera.x * ratio, y: camera.y * ratio };
    } else {
      camera = { x: layout.cellWidth * 0.5, y: layout.cellHeight * 0.5 };
    }
    targetPx = targetSize(cssSize, dpr, STRENGTH_DRAGGING);
    gl.deleteFramebuffer(target.buffer);
    gl.deleteTexture(target.texture.texture);
    target = new RenderTarget(gl, {
      width: targetPx.width,
      height: targetPx.height,
      depth: false,
    });
    postProgram.uniforms.tScene.value = target.texture;
    postProgram.uniforms.uAspect.value = cssSize.width / cssSize.height;
    gridProgram.uniforms.uRingWidth.value = [
      (2 * dpr) / layout.cellWidth,
      (2 * dpr) / layout.cellHeight,
    ];

    // Slots at the cell's size on screen, shrunk only if a screenful would not fit the atlas.
    const visible = visibleCells(layout, camera, targetPx).length;
    let slotWidth = Math.min(Math.round(layout.cellWidth), maxTexture);
    let slotHeight = Math.round(
      slotWidth * (layout.cellHeight / layout.cellWidth),
    );
    while (
      Math.floor(maxTexture / slotWidth) * Math.floor(maxTexture / slotHeight) <
        visible * 1.25 &&
      slotWidth > 96
    ) {
      slotWidth = Math.round(slotWidth * 0.9);
      slotHeight = Math.round(
        slotWidth * (layout.cellHeight / layout.cellWidth),
      );
    }
    if (
      !atlas ||
      atlas.slotWidth !== slotWidth ||
      atlas.slotHeight !== slotHeight
    ) {
      atlas = new Atlas(gl, maxTexture, slotWidth, slotHeight);
      gridProgram.uniforms.tAtlas.value = atlas.texture;
    }
    atlas.reset();
    invalidate();
  }

  function paintCard(index: number, slot: number) {
    const card = cards[index];
    if (!card || !atlas || !scratchCtx) return;
    const currentAtlas = atlas;
    scratch.width = currentAtlas.slotWidth;
    scratch.height = currentAtlas.slotHeight;
    const cssWidth = layout.cellWidth / dpr;
    const draw = (
      logo: HTMLImageElement | null,
      cover: HTMLImageElement | null,
    ) => {
      if (
        disposed ||
        atlas !== currentAtlas ||
        !currentAtlas.holds(index, slot)
      )
        return;
      scratch.width = currentAtlas.slotWidth;
      scratch.height = currentAtlas.slotHeight;
      rasterCard(scratchCtx, card, { logo, cover }, theme, cssWidth);
      currentAtlas.paint(slot, scratch);
      invalidate();
    };
    // Paint at once without images, then again as they arrive.
    draw(null, null);
    const logoUrl = card.logo ? variantFor(card.logo, 64) : null;
    const coverUrl = card.cover
      ? variantFor(card.cover, currentAtlas.slotWidth)
      : null;
    if (logoUrl || coverUrl) {
      Promise.all([
        logoUrl ? loadImage(logoUrl) : null,
        coverUrl ? loadImage(coverUrl) : null,
      ]).then(([logo, cover]) => draw(logo, cover));
    }
  }

  function render(now: number) {
    raf = 0;
    if (disposed) return;
    const started = performance.now();
    const dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 1 / 60;
    lastTime = now;
    let animating = false;

    if (tween) {
      const t = Math.min(1, (now - tween.start) / 450);
      const ease = 1 - (1 - t) ** 3;
      camera = {
        x: tween.from.x + (tween.to.x - tween.from.x) * ease,
        y: tween.from.y + (tween.to.y - tween.from.y) * ease,
      };
      if (t >= 1) tween = null;
      animating = true;
    } else if (inertia.moving) {
      const [dx, dy] = inertia.step(dt);
      camera = { x: camera.x - dx * dpr, y: camera.y - dy * dpr };
      animating = true;
    }

    const wanted = dragging ? STRENGTH_DRAGGING : STRENGTH;
    if (Math.abs(strength - wanted) > 0.001) {
      strength += (wanted - strength) * Math.min(1, dt * 8);
      animating = true;
    } else {
      strength = wanted;
    }
    postProgram.uniforms.uStrength.value = strength;

    const cells = visibleCells(layout, camera, targetPx).slice(
      0,
      MAX_INSTANCES,
    );
    frame++;
    const nextHover = new Map<string, number>();
    cells.forEach((cell, i) => {
      const index = cardIndexAt(layout, cell.column, cell.row);
      const currentAtlas = atlas as Atlas;
      const { slot, fresh } = currentAtlas.acquire(index, frame);
      if (fresh) paintCard(index, slot);
      const [u0, v0, u1, v1] = currentAtlas.uv(slot);
      rects.set(
        [
          (cell.x / targetPx.width) * 2 - 1,
          1 - (cell.y / targetPx.height) * 2,
          (layout.cellWidth / targetPx.width) * 2,
          (layout.cellHeight / targetPx.height) * 2,
        ],
        i * 4,
      );
      uvs.set([u0, v0, u1, v1], i * 4);
      const k = key(cell.column, cell.row);
      const isHovered =
        hovered?.column === cell.column && hovered?.row === cell.row;
      const previous = hoverAmount.get(k) ?? 0;
      const amount =
        previous + ((isHovered ? 1 : 0) - previous) * Math.min(1, dt * 14);
      if (Math.abs(amount - (isHovered ? 1 : 0)) > 0.01) animating = true;
      const settled =
        Math.abs(amount - (isHovered ? 1 : 0)) <= 0.01
          ? isHovered
            ? 1
            : 0
          : amount;
      if (settled > 0) nextHover.set(k, settled);
      states[i * 2] = settled;
      states[i * 2 + 1] = focusedIndex === index ? 1 : 0;
    });
    hoverAmount = nextHover;
    const attributes = quad.attributes;
    (attributes.aRect as { needsUpdate: boolean }).needsUpdate = true;
    (attributes.aUv as { needsUpdate: boolean }).needsUpdate = true;
    (attributes.aState as { needsUpdate: boolean }).needsUpdate = true;
    quad.setInstancedCount(cells.length);

    renderer.render({ scene: gridMesh, target, clear: true });
    renderer.render({ scene: postMesh, clear: false });

    options.onFrame?.(performance.now() - started);
    if (!ready) {
      ready = true;
      options.onReady();
    }
    if (animating) invalidate();
  }

  function invalidate() {
    if (!raf && !disposed) raf = requestAnimationFrame(render);
  }

  // Input.
  let dragging = false;
  let pointerId: number | null = null;
  let downAt = { x: 0, y: 0, time: 0 };
  let last = { x: 0, y: 0 };
  let moved = 0;

  const local = (event: PointerEvent | WheelEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const cardAt = (point: { x: number; y: number }) => {
    const cell = cellAtPointer(
      layout,
      camera,
      cssSize,
      dpr,
      strength,
      point,
      STRENGTH_DRAGGING,
    );
    return { cell, index: cardIndexAt(layout, cell.column, cell.row) };
  };

  function onPointerDown(event: PointerEvent) {
    if (
      pointerId !== null ||
      (event.pointerType === "mouse" && event.button !== 0)
    )
      return;
    pointerId = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    const point = local(event);
    downAt = { ...point, time: event.timeStamp };
    last = point;
    moved = 0;
    tween = null;
    inertia.stop();
    inertia.sample(0, 0, event.timeStamp);
  }

  function onPointerMove(event: PointerEvent) {
    const point = local(event);
    if (event.pointerId === pointerId) {
      const dx = point.x - last.x;
      const dy = point.y - last.y;
      last = point;
      moved += Math.hypot(dx, dy);
      if (moved > DRAG_THRESHOLD_PX) {
        if (!dragging) {
          dragging = true;
          canvas.style.cursor = "grabbing";
          hovered = null;
        }
        camera = { x: camera.x - dx * dpr, y: camera.y - dy * dpr };
        inertia.sample(dx, dy, event.timeStamp);
        invalidate();
      }
      return;
    }
    if (event.pointerType !== "mouse") return;
    const { cell, index } = cardAt(point);
    if (hovered?.column !== cell.column || hovered?.row !== cell.row) {
      hovered = cell;
      options.onHover?.(cards[index] ?? null);
      invalidate();
    }
  }

  function onPointerUp(event: PointerEvent) {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    const wasDrag = dragging;
    dragging = false;
    canvas.style.cursor = "";
    if (wasDrag) {
      inertia.release(event.timeStamp);
    } else if (
      event.type === "pointerup" &&
      event.timeStamp - downAt.time < 600
    ) {
      const card = cards[cardAt(local(event)).index];
      if (card) options.onNavigate(card);
    }
    invalidate();
  }

  function onPointerLeave() {
    if (hovered) {
      hovered = null;
      options.onHover?.(null);
      invalidate();
    }
  }

  function onWheel(event: WheelEvent) {
    event.preventDefault();
    const scale =
      event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? cssSize.height : 1;
    tween = null;
    inertia.stop();
    // Shift+wheel on a mouse scrolls sideways.
    const dx = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
    const dy = event.shiftKey && !event.deltaX ? 0 : event.deltaY;
    camera = { x: camera.x + dx * scale * dpr, y: camera.y + dy * scale * dpr };
    invalidate();
  }

  function onContextLost(event: Event) {
    event.preventDefault();
    options.onFail("context-lost");
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("webglcontextlost", onContextLost);

  const resizeObserver = new ResizeObserver(() => resize());
  resizeObserver.observe(canvas);

  // Theme changes: re-read tokens and repaint every card.
  const retheme = () => {
    theme = readTheme();
    gridProgram.uniforms.uBg.value = parseColor(theme.bg);
    gridProgram.uniforms.uHover.value = parseColor(theme.hover);
    gridProgram.uniforms.uRing.value = parseColor(theme.ring);
    postProgram.uniforms.uBg.value = parseColor(theme.bg);
    postProgram.uniforms.uGlow.value = glowFor(theme.bg);
    atlas?.reset();
    invalidate();
  };
  const themeObserver = new MutationObserver(retheme);
  themeObserver.observe(document.documentElement, {
    attributeFilter: ["data-theme"],
  });
  const colorScheme = window.matchMedia("(prefers-color-scheme: light)");
  colorScheme.addEventListener("change", retheme);

  // Card text uses Geist; repaint once the fonts have loaded if they had not yet.
  document.fonts?.ready.then(() => {
    if (!disposed) retheme();
  });

  resize();

  return {
    focusCard(index) {
      focusedIndex = index;
      if (index !== null && index >= 0 && index < cards.length) {
        // The nearest copy of the card to where the view is now.
        const homeColumn = index % layout.tileColumns;
        const homeRow = Math.floor(index / layout.tileColumns);
        const tileWidth = layout.tileColumns * layout.cellWidth;
        const tileHeight = layout.tileRows * layout.cellHeight;
        const centreX = (homeColumn + 0.5) * layout.cellWidth;
        const centreY = (homeRow + 0.5) * layout.cellHeight;
        const to = {
          x: centreX + Math.round((camera.x - centreX) / tileWidth) * tileWidth,
          y:
            centreY +
            Math.round((camera.y - centreY) / tileHeight) * tileHeight,
        };
        inertia.stop();
        tween = { from: camera, to, start: performance.now() };
      }
      invalidate();
    },
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      colorScheme.removeEventListener("change", retheme);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
