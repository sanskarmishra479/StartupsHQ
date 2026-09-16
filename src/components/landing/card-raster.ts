import type { Image, StartupCard } from "@/types/public";
import { startupChips, startupCorner } from "../cards/startup-card";

// Draws one card into a 2D canvas for the WebGL atlas, to the same plan as EntityCard: logo
// top-left, name top-right, cover in the middle, chips bottom-left, a fact bottom-right. Measures
// are EntityCard's at 320 px wide, scaled to the slot.

export type RasterTheme = Readonly<{
  fg: string;
  fgMuted: string;
  borderStrong: string;
  border: string;
  placeholder: string;
  sans: string;
  mono: string;
}>;

const images = new Map<string, Promise<HTMLImageElement | null>>();

/**
 * Loads an image for texture use. Cross-origin images must be served with CORS, or WebGL refuses
 * them; a failure resolves to null and the card falls back to its initials.
 */
export function loadImage(url: string): Promise<HTMLImageElement | null> {
  let pending = images.get(url);
  if (!pending) {
    pending = new Promise((resolve) => {
      const image = new window.Image();
      image.crossOrigin = "anonymous";
      image.decoding = "async";
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = url;
    });
    images.set(url, pending);
  }
  return pending;
}

/** The smallest variant at least `width` pixels wide, else the largest. */
export function variantFor(image: Image, width: number): string {
  const wide = image.variants.find((variant) => variant.width >= width);
  return (wide ?? image.variants[image.variants.length - 1] ?? image).url;
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letter = (word: string | undefined) =>
    word ? (Array.from(word)[0] ?? "").toLocaleUpperCase() : "";
  return (
    `${letter(words[0])}${words.length > 1 ? letter(words[words.length - 1]) : ""}` ||
    "?"
  );
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const scale = Math.max(
    width / image.naturalWidth,
    height / image.naturalHeight,
  );
  const sw = width / scale;
  const sh = height / scale;
  ctx.drawImage(
    image,
    (image.naturalWidth - sw) / 2,
    (image.naturalHeight - sh) / 2,
    sw,
    sh,
    x,
    y,
    width,
    height,
  );
}

function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut.trimEnd()}…`;
}

export type CardImages = Readonly<{
  logo: HTMLImageElement | null;
  cover: HTMLImageElement | null;
}>;

/**
 * Paints `card` over the whole of `ctx`'s canvas, leaving the cell background transparent: the
 * shader fills it, so hover can tint the cell without re-rasterising.
 */
export function rasterCard(
  ctx: CanvasRenderingContext2D,
  card: StartupCard,
  loaded: CardImages,
  theme: RasterTheme,
  /** The cell's width on screen in CSS pixels; below 13rem the corner drops its detail, as in HTML. */
  cssWidth: number,
): void {
  const { width, height } = ctx.canvas;
  const u = width / 320;
  const pad = 12 * u;
  const row = 20 * u;
  const gap = 12 * u;
  const coverWidth = width - 2 * pad;
  const coverHeight = coverWidth / 1.91;
  const coverTop = pad + row + gap;
  const footerTop = coverTop + coverHeight + gap;
  const metaFont = `500 ${11 * u}px ${theme.mono}`;

  ctx.clearRect(0, 0, width, height);
  ctx.textBaseline = "middle";
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${0.08 * 11 * u}px`;

  // Hairlines on the right and bottom; neighbours supply the other two.
  ctx.fillStyle = theme.border;
  ctx.fillRect(width - Math.max(1, u), 0, Math.max(1, u), height);
  ctx.fillRect(0, height - Math.max(1, u), width, Math.max(1, u));

  // Logo, or initials on a tile.
  const logoSize = row;
  if (loaded.logo) {
    ctx.drawImage(loaded.logo, pad, pad, logoSize, logoSize);
  } else {
    ctx.fillStyle = theme.placeholder;
    ctx.fillRect(pad, pad, logoSize, logoSize);
    ctx.fillStyle = theme.fgMuted;
    ctx.font = `500 ${9 * u}px ${theme.mono}`;
    ctx.textAlign = "center";
    ctx.fillText(initials(card.name), pad + logoSize / 2, pad + logoSize / 2);
  }

  // Name.
  ctx.font = metaFont;
  ctx.textAlign = "right";
  ctx.fillStyle = theme.fg;
  ctx.fillText(
    fitText(ctx, card.name.toUpperCase(), width - 2 * pad - logoSize - gap),
    width - pad,
    pad + row / 2,
  );

  // Cover, or the logo centred on a neutral tile, or large initials.
  ctx.fillStyle = theme.placeholder;
  ctx.fillRect(pad, coverTop, coverWidth, coverHeight);
  if (loaded.cover) {
    drawCover(ctx, loaded.cover, pad, coverTop, coverWidth, coverHeight);
  } else if (loaded.logo) {
    const size = coverHeight * 0.4;
    ctx.drawImage(
      loaded.logo,
      pad + (coverWidth - size) / 2,
      coverTop + (coverHeight - size) / 2,
      size,
      size,
    );
  } else {
    ctx.fillStyle = theme.fgMuted;
    ctx.font = `500 ${18 * u}px ${theme.mono}`;
    ctx.textAlign = "center";
    ctx.fillText(initials(card.name), width / 2, coverTop + coverHeight / 2);
  }

  // Corner fact, then as many chips as fit before it.
  ctx.font = metaFont;
  const corner = startupCorner(card);
  let chipsRight = width - pad;
  if (corner) {
    const text =
      corner.detail && cssWidth >= 208
        ? `${corner.main} · ${corner.detail}`
        : corner.main;
    ctx.textAlign = "right";
    ctx.fillStyle = theme.fgMuted;
    ctx.fillText(text.toUpperCase(), width - pad, footerTop + row / 2);
    chipsRight -= ctx.measureText(text.toUpperCase()).width + 8 * u;
  }
  ctx.textAlign = "left";
  let x = pad;
  const chipPad = 6 * u;
  for (const chip of startupChips(card)) {
    const label = chip.toUpperCase();
    const room = chipsRight - x;
    const full = ctx.measureText(label).width + 2 * chipPad;
    if (full > room && x > pad) break;
    const text = full > room ? fitText(ctx, label, room - 2 * chipPad) : label;
    const chipWidth = Math.min(full, room);
    ctx.strokeStyle = theme.borderStrong;
    ctx.lineWidth = Math.max(1, u);
    ctx.strokeRect(x + 0.5 * u, footerTop + 0.5 * u, chipWidth - u, row - u);
    ctx.fillStyle = theme.fgMuted;
    ctx.fillText(text, x + chipPad, footerTop + row / 2);
    x += chipWidth + 4 * u;
  }
}
