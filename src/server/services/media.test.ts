import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../db/client";
import { mediaAssets, startups } from "../db/schema";
import { seed } from "../db/seed";
import { localBlobs } from "../lib/blob";
import {
  PayloadTooLargeError,
  UnprocessableError,
  UnsupportedMediaTypeError,
  ValidationError,
} from "../lib/errors";
import { contexts } from "../testing/authz";
import { fixtureId, startups as startupsTable } from "../testing/fixtures";
import { ensureTestUsers } from "../testing/users";
import * as media from "./media";

// docs/TEST_PLAN.md §8 SEC-06 and FR-408/FR-111: every upload is sniffed, pixel-capped and
// re-encoded, share cards are rendered once at publish, and the GC removes what nothing uses.

const editor = contexts.editor;
const admin = contexts.admin;

beforeAll(async () => {
  await seed(getDb());
  await ensureTestUsers();
});

afterAll(async () => {
  await closeDb();
});

const png = (width: number, height: number, colour = "#3355ff") =>
  sharp({ create: { width, height, channels: 3, background: colour } })
    .png()
    .toBuffer();

const jpeg = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: "#ff8800" } })
    .jpeg()
    .toBuffer();

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A PNG whose header claims 50,000 x 50,000 px with almost no data behind it: the decompression
 * bomb SEC-06 names. The pixel count must be refused from the header, never decoded.
 */
function pixelBombPng(): Buffer {
  const chunk = (type: string, body: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.byteLength);
    const typed = Buffer.concat([Buffer.from(type, "ascii"), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([length, typed, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(50_000, 0);
  ihdr.writeUInt32BE(50_000, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", Buffer.from([0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x01])),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const storedBytes = (url: string): Uint8Array => {
  const path = new URL(url).pathname.slice(1);
  const blob = localBlobs.get(path);
  if (!blob) throw new Error(`Nothing stored at ${path}`);
  return blob.body;
};

describe("uploads are sniffed and re-encoded (SEC-06)", () => {
  it("believes the magic bytes, not the name or the declared type", async () => {
    const asset = await media.upload(editor, {
      purpose: "logo",
      bytes: await png(300, 300),
    });
    expect(asset.state).toBe("staging");
    expect(asset.purpose).toBe("logo");

    for (const variant of asset.image.variants) {
      const path = new URL(variant.url).pathname.slice(1);
      expect(localBlobs.get(path)?.contentType).toBe("image/webp");
      expect((await sharp(storedBytes(variant.url)).metadata()).format).toBe(
        "webp",
      );
    }
  });

  it("renders one variant per width that fits, and never upscales", async () => {
    const wide = await media.upload(editor, {
      purpose: "logo",
      bytes: await png(400, 400),
    });
    expect(wide.image.variants.map((variant) => variant.width)).toEqual([
      64, 128, 256,
    ]);

    const small = await media.upload(editor, {
      purpose: "logo",
      bytes: await png(100, 100),
    });
    expect(small.image.variants.map((variant) => variant.width)).toEqual([64]);

    const tiny = await media.upload(editor, {
      purpose: "logo",
      bytes: await png(40, 40),
    });
    expect(tiny.image.variants.map((variant) => variant.width)).toEqual([40]);
  });

  it("uses the widths each purpose needs", async () => {
    const cover = await media.upload(editor, {
      purpose: "cover",
      bytes: await png(2000, 1000),
    });
    expect(cover.image.variants.map((variant) => variant.width)).toEqual([
      640, 1280, 1920,
    ]);

    const photo = await media.upload(editor, {
      purpose: "photo",
      bytes: await png(600, 600),
    });
    expect(photo.image.variants.map((variant) => variant.width)).toEqual([
      128, 256, 512,
    ]);
  });

  it("carries a blur placeholder the schema accepts", async () => {
    const asset = await media.upload(editor, {
      purpose: "logo",
      bytes: await png(256, 256),
    });
    expect(asset.image.blurDataUrl).toMatch(
      /^data:image\/webp;base64,[A-Za-z0-9+/=]+$/,
    );
  });

  it("strips EXIF, including location", async () => {
    const withExif = await sharp(await jpeg(300, 200))
      .withExif({
        IFD0: { Copyright: "startupsHQ" },
        IFD3: { GPSLatitudeRef: "N" },
      })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();

    const asset = await media.upload(editor, {
      purpose: "cover",
      bytes: withExif,
    });
    const first = asset.image.variants[0];
    if (!first) throw new Error("no variant");
    expect(
      (await sharp(storedBytes(first.url)).metadata()).exif,
    ).toBeUndefined();
  });

  it.each([
    [
      "an SVG, even a harmless one",
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>',
      ),
    ],
    [
      "an SVG carrying a script",
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("https://evil.example")</script></svg>',
      ),
    ],
    [
      "an SVG referencing a remote file",
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/></svg>',
      ),
    ],
    ["a GIF/JS polyglot", Buffer.from("GIF89a/*comment*/=1;alert(1);//")],
    [
      "an HTML file named as an image",
      Buffer.from("<!doctype html><h1>hi</h1>"),
    ],
    ["random bytes", Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])],
  ])("refuses %s", async (_label, bytes) => {
    await expect(
      media.upload(editor, { purpose: "logo", bytes }),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeError);
  });

  it("accepts AVIF, which many sites now serve their logos in, and re-encodes it", async () => {
    const avif = await sharp({
      create: { width: 300, height: 300, channels: 3, background: "#22aa66" },
    })
      .avif()
      .toBuffer();
    const asset = await media.upload(editor, { purpose: "logo", bytes: avif });
    expect(asset.image.variants.map((variant) => variant.width)).toEqual([
      64, 128, 256,
    ]);
    for (const variant of asset.image.variants) {
      expect((await sharp(storedBytes(variant.url)).metadata()).format).toBe(
        "webp",
      );
    }
  });

  /** An ISO BMFF header: box size, `ftyp`, major brand, minor version, compatible brands. */
  const ftyp = (
    major: string,
    compatible: readonly string[],
    rest = Buffer.alloc(64, 0),
  ) => {
    const brands = Buffer.from(
      [major, "\0\0\0\0", ...compatible].join(""),
      "latin1",
    );
    const size = Buffer.alloc(4);
    size.writeUInt32BE(8 + brands.byteLength);
    return Buffer.concat([size, Buffer.from("ftyp"), brands, rest]);
  };

  it("refuses HEIC and other HEIF files that are not AVIF", async () => {
    await expect(
      media.upload(editor, {
        purpose: "logo",
        bytes: ftyp("heic", ["mif1", "heic"]),
      }),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeError);
  });

  it("refuses a file that only claims to be AVIF", async () => {
    await expect(
      media.upload(editor, {
        purpose: "logo",
        bytes: ftyp("mif1", ["avif", "mif1"]),
      }),
    ).rejects.toBeInstanceOf(UnprocessableError);
  });

  it("refuses a file over 5 MB before reading it as an image", async () => {
    await expect(
      media.upload(editor, {
        purpose: "logo",
        bytes: Buffer.alloc(6 * 1024 * 1024, 7),
      }),
    ).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it("refuses a small file claiming 50,000 x 50,000 pixels", async () => {
    const bomb = pixelBombPng();
    expect(bomb.byteLength).toBeLessThan(200);

    const refusal = media.upload(editor, { purpose: "logo", bytes: bomb });
    await expect(refusal).rejects.toBeInstanceOf(UnprocessableError);
    await expect(refusal).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" });
  });

  it("refuses an empty file and an unknown purpose", async () => {
    await expect(
      media.upload(editor, { purpose: "logo", bytes: new Uint8Array() }),
    ).rejects.toBeInstanceOf(ValidationError);
    // Share cards are rendered by the server, never uploaded.
    await expect(
      media.upload(editor, { purpose: "og", bytes: await png(64, 64) }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("share cards (FR-111)", () => {
  it("renders a card, points the record at it and replaces the old one", async () => {
    const id = await fixtureId(startupsTable, "kiln-analytics");
    const db = getDb();

    const first = await media.refreshOgImage(editor, "startup", id);
    const [afterFirst] = await db
      .select({ ogAssetId: startups.ogAssetId })
      .from(startups)
      .where(eq(startups.id, id));
    expect(afterFirst?.ogAssetId).toBe(first.assetId);

    const [asset] = await db
      .select({
        purpose: mediaAssets.purpose,
        state: mediaAssets.state,
        variants: mediaAssets.variants,
        prefix: mediaAssets.blobPrefix,
      })
      .from(mediaAssets)
      .where(eq(mediaAssets.id, first.assetId));
    expect(asset?.purpose).toBe("og");
    expect(asset?.state).toBe("attached");
    const card = asset?.variants[0];
    if (!card) throw new Error("no card variant");
    expect([card.width, card.height]).toEqual([1200, 630]);
    expect((await sharp(storedBytes(card.url)).metadata()).format).toBe("webp");

    const second = await media.refreshOgImage(editor, "startup", id);
    expect(second.assetId).not.toBe(first.assetId);
    const rows = await db
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(eq(mediaAssets.id, first.assetId));
    expect(rows).toEqual([]);
    expect(
      [...localBlobs.keys()].some((key) => key.startsWith(`${asset?.prefix}/`)),
    ).toBe(false);
  });

  it("answers an unknown record or entity with a 404", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    await expect(
      media.refreshOgImage(editor, "startup", missing),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      media.refreshOgImage(editor, "round", missing),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("media garbage collection (FR-408)", () => {
  const backdate = (
    id: string,
    column: "created_at" | "attached_at",
    hours: number,
  ) =>
    getDb().execute(
      sql`update ${mediaAssets} set ${sql.raw(column)} = now() - ${`${hours} hours`}::interval where ${mediaAssets.id} = ${id}`,
    );

  it("deletes staged uploads nobody saved, and their blobs", async () => {
    const asset = await media.upload(editor, {
      purpose: "logo",
      bytes: await png(128, 128),
    });
    const paths = asset.image.variants.map((variant) =>
      new URL(variant.url).pathname.slice(1),
    );
    expect(paths.every((path) => localBlobs.has(path))).toBe(true);

    // Fresh uploads are left alone.
    await media.collectGarbage(admin);
    expect(paths.every((path) => localBlobs.has(path))).toBe(true);

    await backdate(asset.assetId, "created_at", 25);
    const swept = await media.collectGarbage(admin);
    expect(swept.deleted).toBeGreaterThanOrEqual(1);
    expect(paths.some((path) => localBlobs.has(path))).toBe(false);

    const rows = await getDb()
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(eq(mediaAssets.id, asset.assetId));
    expect(rows).toEqual([]);
  });

  it("keeps an attached asset a record still uses, however old", async () => {
    const id = await fixtureId(startupsTable, "kiln-analytics");
    const { assetId } = await media.refreshOgImage(editor, "startup", id);
    await backdate(assetId, "attached_at", 24 * 30);

    await media.collectGarbage(admin);
    const rows = await getDb()
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(eq(mediaAssets.id, assetId));
    expect(rows).toHaveLength(1);
  });

  it("deletes an attached asset nothing references after a week", async () => {
    const asset = await media.upload(editor, {
      purpose: "photo",
      bytes: await png(256, 256),
    });
    await getDb()
      .update(mediaAssets)
      .set({ state: "attached", attachedAt: new Date() })
      .where(eq(mediaAssets.id, asset.assetId));
    await backdate(asset.assetId, "attached_at", 24 * 8);

    await media.collectGarbage(admin);
    const rows = await getDb()
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(eq(mediaAssets.id, asset.assetId));
    expect(rows).toEqual([]);
  });

  it("stores every asset under its own unguessable prefix", async () => {
    const one = await media.upload(editor, {
      purpose: "logo",
      bytes: await png(64, 64),
    });
    const two = await media.upload(editor, {
      purpose: "logo",
      bytes: await png(64, 64),
    });
    const prefixOf = (url: string) =>
      new URL(url).pathname.split("/").slice(1, 4).join("/");
    const first = prefixOf(one.image.url);
    const second = prefixOf(two.image.url);
    expect(first).not.toBe(second);
    expect(first).toMatch(/^media\/logo\/[0-9a-f]{32}$/);
    // Identical bytes, different location: nothing about a path is derived from the content.
    expect(
      createHash("sha256").update(storedBytes(one.image.url)).digest("hex"),
    ).toBe(
      createHash("sha256").update(storedBytes(two.image.url)).digest("hex"),
    );
  });
});
