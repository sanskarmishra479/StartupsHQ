import "server-only";

import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import sharp, { type Metadata, type OutputInfo } from "sharp";
import type { ReadContext } from "../auth/context";
import { assertAdmin, assertEditor } from "../auth/guards";
import { type Database, getDb, type Transaction } from "../db/client";
import { sweepMediaAssets } from "../db/media-gc";
import { runMutation } from "../db/mutation";
import {
  batches,
  founders,
  investors,
  mediaAssets,
  startups,
} from "../db/schema";
import type { MediaVariant } from "../db/schema/media";
import {
  batchTags,
  founderTags,
  investorTags,
  startupTags,
} from "../db/writes/tags";
import { type Image, toImage } from "../dto/image";
import { deleteBlobPrefix, putBlob } from "../lib/blob";
import {
  NotFoundError,
  PayloadTooLargeError,
  UnprocessableError,
  UnsupportedMediaTypeError,
  ValidationError,
} from "../lib/errors";

// The media pipeline (docs/API.md §8.5, FR-408, FR-111, SEC-06).
//
// Nothing is stored as it arrived. Every upload is sniffed by magic bytes, pixel-capped, then
// re-encoded into fixed-width WebP renditions, which is also what strips EXIF and anything hidden
// in the original. Accepted inputs are JPEG, PNG and WebP only: SVG means parsing XML, the most
// exploited path in image libraries, and since we always rasterise, accepting it buys nothing but
// that risk (decided 2026-09-16, tightening SEC-06). Assets start in `staging`; saving a record
// that references one attaches it, and the GC removes the rest.

export const UPLOAD_PURPOSES = ["logo", "cover", "photo"] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

/** Widths per purpose (SRS §4.11). A source narrower than a width is never upscaled. */
const WIDTHS: Record<UploadPurpose, readonly number[]> = {
  logo: [64, 128, 256],
  cover: [640, 1280, 1920],
  photo: [128, 256, 512],
};

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Decompression-bomb guard: sharp refuses to decode beyond this, header or not. */
export const MAX_INPUT_PIXELS = 24_000_000;

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const BLUR_WIDTH = 16;
const WEBP_QUALITY = 82;
const MAX_OG_SUBTITLE = 160;

export type UploadedAsset = Readonly<{
  assetId: string;
  state: "staging";
  purpose: UploadPurpose;
  image: Image;
}>;

export type UploadInput = Readonly<{ purpose: string; bytes: Uint8Array }>;

/** Magic bytes decide the type; a filename or a declared Content-Type never does (SEC-06). */
function sniff(bytes: Uint8Array): "jpeg" | "png" | "webp" | null {
  if (bytes.byteLength < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "jpeg";

  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((byte, index) => bytes[index] === byte)) return "png";

  const ascii = (start: number, text: string) =>
    [...text].every((character, index) => {
      return bytes[start + index] === character.charCodeAt(0);
    });
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "webp";

  return null;
}

const decoder = (bytes: Uint8Array) =>
  sharp(Buffer.from(bytes), {
    limitInputPixels: MAX_INPUT_PIXELS,
    failOn: "error",
    // One frame only: an animation would multiply the work for no editorial gain.
    animated: false,
  });

/**
 * Reads only the header, so the dimensions can be reported before anything is decoded. The pixel
 * limit is deliberately off here: with it on, sharp refuses the header itself and we could not
 * tell a bomb (`422 IMAGE_TOO_LARGE`) from an unreadable file. The decoder above keeps the limit.
 */
const header = (bytes: Uint8Array) =>
  sharp(Buffer.from(bytes), { limitInputPixels: false, failOn: "error" });

type Rendered = Readonly<{
  variants: MediaVariant[];
  blurDataUrl: string;
}>;

async function renderVariants(
  bytes: Uint8Array,
  widths: readonly number[],
  prefix: string,
): Promise<Rendered> {
  let metadata: Metadata;
  try {
    metadata = await header(bytes).metadata();
  } catch {
    throw new UnprocessableError("That image could not be read.");
  }
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width < 1 || height < 1) {
    throw new UnprocessableError("That image could not be read.");
  }
  // Checked from the header, before any pixel is decoded.
  if (width * height > MAX_INPUT_PIXELS) {
    throw new UnprocessableError(
      "That image has too many pixels: 24 million is the limit.",
      "IMAGE_TOO_LARGE",
    );
  }

  const fitting = widths.filter((target) => target <= width);
  const targets = fitting.length > 0 ? fitting : [width];

  const variants: MediaVariant[] = [];
  for (const target of targets) {
    let encoded: { data: Buffer; info: OutputInfo };
    try {
      encoded = await decoder(bytes)
        // Honours EXIF orientation, then drops the metadata with it.
        .rotate()
        .resize({ width: target, withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw new UnprocessableError("That image could not be read.");
    }
    const stored = await putBlob(
      `${prefix}/${target}.webp`,
      encoded.data,
      "image/webp",
    );
    variants.push({
      width: encoded.info.width,
      height: encoded.info.height,
      url: stored.url,
      bytes: stored.bytes,
    });
  }

  const blur = await decoder(bytes)
    .rotate()
    .resize({ width: BLUR_WIDTH })
    .webp({ quality: 40 })
    .toBuffer();

  return {
    variants,
    blurDataUrl: `data:image/webp;base64,${blur.toString("base64")}`,
  };
}

const randomPrefix = (purpose: string) =>
  `media/${purpose}/${randomBytes(16).toString("hex")}`;

/**
 * An editor's upload: validated, re-encoded and stored as a staging asset. Staging assets are not
 * audited — attaching one is part of the record's own audited save (FR-405).
 */
export async function upload(
  ctx: ReadContext,
  input: UploadInput,
): Promise<UploadedAsset> {
  assertEditor(ctx);

  if (!(UPLOAD_PURPOSES as readonly string[]).includes(input.purpose)) {
    throw new ValidationError([
      { path: "purpose", message: `Use one of ${UPLOAD_PURPOSES.join(", ")}.` },
    ]);
  }
  const purpose = input.purpose as UploadPurpose;

  if (input.bytes.byteLength === 0) {
    throw new ValidationError([
      { path: "file", message: "The file is empty." },
    ]);
  }
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new PayloadTooLargeError("Images must be 5 MB or smaller.");
  }
  if (sniff(input.bytes) === null) {
    throw new UnsupportedMediaTypeError(
      "Upload a JPEG, PNG or WebP image. SVG is not accepted — export it as PNG first.",
    );
  }

  return store(ctx.actor.id, purpose, input.bytes, null);
}

export type RemoteImageInput = Readonly<{
  purpose: UploadPurpose;
  bytes: Uint8Array;
  /** Where it was fetched from, recorded on the asset (FR-401). */
  sourceUrl: string;
}>;

/**
 * An image prefill fetched from a company's own site. Exactly the checks an upload gets — the
 * bytes are attacker-influenced either way — plus the URL it came from.
 */
export async function storeRemoteImage(
  ctx: ReadContext,
  input: RemoteImageInput,
): Promise<UploadedAsset> {
  assertEditor(ctx);
  if (input.bytes.byteLength === 0) {
    throw new ValidationError([
      { path: "file", message: "The file is empty." },
    ]);
  }
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new PayloadTooLargeError("Images must be 5 MB or smaller.");
  }
  if (sniff(input.bytes) === null) {
    throw new UnsupportedMediaTypeError(
      "That file is not a JPEG, PNG or WebP image.",
    );
  }
  return store(ctx.actor.id, input.purpose, input.bytes, input.sourceUrl);
}

async function store(
  actorId: string,
  purpose: UploadPurpose,
  bytes: Uint8Array,
  sourceUrl: string | null,
): Promise<UploadedAsset> {
  const prefix = randomPrefix(purpose);
  const { variants, blurDataUrl } = await renderVariants(
    bytes,
    WIDTHS[purpose],
    prefix,
  );

  const [row] = await getDb()
    .insert(mediaAssets)
    .values({
      blobPrefix: prefix,
      purpose,
      state: "staging",
      variants,
      blurDataUrl,
      sourceUrl,
      createdBy: actorId,
    })
    .returning({ id: mediaAssets.id });
  if (!row) throw new Error("The media asset was not stored.");

  return {
    assetId: row.id,
    state: "staging",
    purpose,
    image: toImage({ variants, blurDataUrl }) as Image,
  };
}

// ── Share cards (FR-111) ─────────────────────────────────────────────────────────────────────

export const OG_ENTITIES = ["startup", "founder", "investor", "batch"] as const;
export type OgEntity = (typeof OG_ENTITIES)[number];

type OgSubject = Readonly<{
  title: string;
  subtitle: string | null;
  previousAssetId: string | null;
}>;

async function loadOgSubject(
  db: Database,
  entity: OgEntity,
  id: string,
): Promise<OgSubject> {
  const trim = (value: string | null) =>
    value === null ? null : value.slice(0, MAX_OG_SUBTITLE);

  switch (entity) {
    case "startup": {
      const [row] = await db
        .select({
          title: startups.name,
          subtitle: startups.tagline,
          previous: startups.ogAssetId,
        })
        .from(startups)
        .where(eq(startups.id, id));
      if (!row) throw new NotFoundError();
      return {
        title: row.title,
        subtitle: trim(row.subtitle),
        previousAssetId: row.previous,
      };
    }
    case "founder": {
      const [row] = await db
        .select({
          title: founders.fullName,
          subtitle: founders.headline,
          previous: founders.ogAssetId,
        })
        .from(founders)
        .where(eq(founders.id, id));
      if (!row) throw new NotFoundError();
      return {
        title: row.title,
        subtitle: trim(row.subtitle),
        previousAssetId: row.previous,
      };
    }
    case "investor": {
      const [row] = await db
        .select({
          title: investors.name,
          subtitle: investors.description,
          previous: investors.ogAssetId,
        })
        .from(investors)
        .where(eq(investors.id, id));
      if (!row) throw new NotFoundError();
      return {
        title: row.title,
        subtitle: trim(row.subtitle),
        previousAssetId: row.previous,
      };
    }
    default: {
      const [row] = await db
        .select({
          title: batches.programName,
          label: batches.label,
          year: batches.year,
          previous: batches.ogAssetId,
        })
        .from(batches)
        .where(eq(batches.id, id));
      if (!row) throw new NotFoundError();
      return {
        title: row.title,
        subtitle: `${row.label} · ${row.year}`,
        previousAssetId: row.previous,
      };
    }
  }
}

async function setOgAsset(
  tx: Transaction,
  entity: OgEntity,
  id: string,
  assetId: string,
): Promise<void> {
  switch (entity) {
    case "startup":
      await tx
        .update(startups)
        .set({ ogAssetId: assetId })
        .where(eq(startups.id, id));
      return;
    case "founder":
      await tx
        .update(founders)
        .set({ ogAssetId: assetId })
        .where(eq(founders.id, id));
      return;
    case "investor":
      await tx
        .update(investors)
        .set({ ogAssetId: assetId })
        .where(eq(investors.id, id));
      return;
    default:
      await tx
        .update(batches)
        .set({ ogAssetId: assetId })
        .where(eq(batches.id, id));
  }
}

const ogTags = (tx: Transaction, entity: OgEntity, id: string) => {
  switch (entity) {
    case "startup":
      return startupTags(tx, [id]);
    case "founder":
      return founderTags(tx, [id]);
    case "investor":
      return investorTags(tx, [id]);
    default:
      return batchTags(tx, [id]);
  }
};

/** Rendered with next/og, then re-encoded to WebP like any other image. */
async function renderOgPng(
  title: string,
  subtitle: string | null,
): Promise<Buffer> {
  const [{ ImageResponse }, { createElement }] = await Promise.all([
    import("next/og"),
    import("react"),
  ]);

  const card = createElement(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        backgroundColor: "#0b0d12",
        color: "#f5f6f8",
        padding: "72px",
        fontSize: 40,
      },
    },
    createElement(
      "div",
      {
        style: { display: "flex", flexDirection: "column", gap: "24px" },
      },
      createElement(
        "div",
        { style: { fontSize: 76, fontWeight: 700, lineHeight: 1.1 } },
        title,
      ),
      subtitle === null
        ? null
        : createElement(
            "div",
            { style: { fontSize: 38, color: "#a3adbb", lineHeight: 1.3 } },
            subtitle,
          ),
    ),
    createElement(
      "div",
      { style: { fontSize: 30, color: "#7c8798", letterSpacing: "0.04em" } },
      "StartupsHQ",
    ),
  );

  const response = new ImageResponse(card, {
    width: OG_WIDTH,
    height: OG_HEIGHT,
  });
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Renders a record's share card, stores it as an `og` asset and points the record at it,
 * replacing whatever was there. Called after a publish and after editing a live record, never
 * per request (ADR-012: zero image transformations).
 */
export async function refreshOgImage(
  ctx: ReadContext,
  entity: string,
  id: string,
): Promise<{ assetId: string }> {
  assertEditor(ctx);
  if (!(OG_ENTITIES as readonly string[]).includes(entity)) {
    throw new NotFoundError();
  }
  const subject = await loadOgSubject(getDb(), entity as OgEntity, id);

  const png = await renderOgPng(subject.title, subject.subtitle);
  const prefix = randomPrefix("og");
  const encoded = await sharp(png)
    .resize({ width: OG_WIDTH, height: OG_HEIGHT, fit: "cover" })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer({ resolveWithObject: true });
  const stored = await putBlob(
    `${prefix}/${OG_WIDTH}.webp`,
    encoded.data,
    "image/webp",
  );

  const replaced = await runMutation(async (tx, tags) => {
    const [asset] = await tx
      .insert(mediaAssets)
      .values({
        blobPrefix: prefix,
        purpose: "og",
        state: "attached",
        attachedAt: new Date(),
        variants: [
          {
            width: encoded.info.width,
            height: encoded.info.height,
            url: stored.url,
            bytes: stored.bytes,
          },
        ],
        createdBy: ctx.actor.id,
      })
      .returning({ id: mediaAssets.id });
    if (!asset) throw new Error("The share card was not stored.");

    await setOgAsset(tx, entity as OgEntity, id, asset.id);

    // The record points at the new card first, so the old row can go without blanking anything.
    let previousPrefix: string | null = null;
    if (subject.previousAssetId !== null) {
      const [old] = await tx
        .delete(mediaAssets)
        .where(eq(mediaAssets.id, subject.previousAssetId))
        .returning({ blobPrefix: mediaAssets.blobPrefix });
      previousPrefix = old?.blobPrefix ?? null;
    }

    for (const tag of await ogTags(tx, entity as OgEntity, id)) tags.add(tag);
    return { assetId: asset.id, previousPrefix };
  });

  if (replaced.previousPrefix !== null) {
    // The card is already live; failing to tidy the old blobs is the GC's problem, not the caller's.
    try {
      await deleteBlobPrefix(replaced.previousPrefix);
    } catch (error) {
      console.error("[media] the replaced share card was not deleted", error);
    }
  }
  return { assetId: replaced.assetId };
}

// ── Garbage collection (FR-408) ──────────────────────────────────────────────────────────────

export type MediaSweep = Readonly<{ deleted: number; blobsDeleted: number }>;

/** Runs the sweep the maintenance job runs; admin-only over HTTP. */
export async function collectGarbage(
  ctx: ReadContext,
  now: Date = new Date(),
): Promise<MediaSweep> {
  assertAdmin(ctx);
  const swept = await sweepMediaAssets(getDb(), now);
  let blobsDeleted = 0;
  for (const asset of swept) {
    blobsDeleted += await deleteBlobPrefix(asset.blobPrefix);
  }
  return { deleted: swept.length, blobsDeleted };
}
