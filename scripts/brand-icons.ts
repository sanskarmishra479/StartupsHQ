import { writeFileSync } from "node:fs";
import sharp from "sharp";
import { MARK_ARTBOARD, MARK_PARTS } from "../src/components/brand/mark";

// Regenerates the site icons from the mark's geometry (Next.js metadata file conventions):
//
//   pnpm brand:icons
//
//   src/app/icon.svg        transparent, recoloured for dark browser chrome
//   src/app/favicon.ico     16, 32 and 48 px, on the brand's white tile
//   src/app/apple-icon.png  180 px, on the brand's white tile (iOS rounds the corners)
//
// Generated rather than copied from public/brand/ so no editor or provenance metadata from the
// source files is served with every page, and so the icons cannot drift from the inline logo.

/** Solid and grey halves: the source file's near-black, and the middle of its grey gradient. */
const LIGHT = { solid: "#0d0d0d", tint: "#c8c8c8" };
/** Browser chrome in dark mode: the dark theme's foreground and a grey that reads beside it. */
const DARK = { solid: "#f5f5f5", tint: "#6e6e6e" };

const shapes = MARK_PARTS.map(
  ({ tone, rects }) =>
    `<g class="${tone}">${rects
      .map(
        ({ x, y, width, height, rx }) =>
          `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}"/>`,
      )
      .join("")}</g>`,
).join("");

function svg(options: { tile: boolean; adaptive: boolean }): string {
  const tones = (t: typeof LIGHT) =>
    `.solid{fill:${t.solid}}.tint{fill:${t.tint}}`;
  const style = `<style>${tones(LIGHT)}${
    options.adaptive ? `@media (prefers-color-scheme:dark){${tones(DARK)}}` : ""
  }</style>`;
  const tile = options.tile
    ? `<rect width="${MARK_ARTBOARD}" height="${MARK_ARTBOARD}" fill="#ffffff"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARK_ARTBOARD} ${MARK_ARTBOARD}">${style}${tile}${shapes}</svg>\n`;
}

/** An .ico holding PNG images, which every current browser reads. */
function ico(images: readonly { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, index) => {
    const entry = 6 + 16 * index;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map(({ png }) => png)]);
}

const png = (source: string, size: number) =>
  sharp(Buffer.from(source), { density: 72 * (size / MARK_ARTBOARD) * 4 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();

async function main(): Promise<void> {
  const tiled = svg({ tile: true, adaptive: false });
  writeFileSync("src/app/icon.svg", svg({ tile: false, adaptive: true }));
  writeFileSync(
    "src/app/favicon.ico",
    ico(
      await Promise.all(
        [16, 32, 48].map(async (size) => ({
          size,
          png: await png(tiled, size),
        })),
      ),
    ),
  );
  writeFileSync("src/app/apple-icon.png", await png(tiled, 180));
  console.log("Wrote src/app/icon.svg, favicon.ico and apple-icon.png.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
