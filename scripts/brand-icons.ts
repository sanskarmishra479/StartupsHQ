import { writeFileSync } from "node:fs";
import sharp from "sharp";
import {
  MARK_ARTBOARD,
  MARK_PARTS,
  MARK_TONES,
} from "../src/components/brand/mark";

// Regenerates the site icons from the mark's geometry (Next.js metadata file conventions):
//
//   pnpm brand:icons
//
//   src/app/icon.svg        on the brand's white tile, so the tab icon reads on light and dark chrome
//   src/app/favicon.ico     16, 32 and 48 px, on the same tile
//   src/app/apple-icon.png  180 px, on the brand's white tile (iOS rounds the corners)
//
// Generated rather than copied from public/brand/ so no editor or provenance metadata from the
// source files is served with every page, and so the icons cannot drift from the inline logo.

const { tile: TILE, solid: SOLID, tint: TINT } = MARK_TONES;

const shapes = MARK_PARTS.map(
  ({ tone, rects }) =>
    `<g class="${tone}">${rects
      .map(
        ({ x, y, width, height, rx }) =>
          `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}"/>`,
      )
      .join("")}</g>`,
).join("");

/** The mark centred on a white square, as in the owner's source file. */
const tiled = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARK_ARTBOARD} ${MARK_ARTBOARD}"><style>.solid{fill:${SOLID}}.tint{fill:${TINT}}</style><rect width="${MARK_ARTBOARD}" height="${MARK_ARTBOARD}" fill="${TILE}"/>${shapes}</svg>\n`;

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
  writeFileSync("src/app/icon.svg", tiled);
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
