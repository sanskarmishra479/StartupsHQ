import "server-only";

import { del, list, put } from "@vercel/blob";

// Image storage (ADR-010, ADR-012). Variants are written once under a random prefix and served
// straight from the Blob CDN, never through an image optimizer. Without a token — development and
// tests — uploads stay in memory, the way lib/email keeps messages in an outbox, so no test ever
// reaches the network. Production refuses to run without a token rather than losing an upload.

type Env = Readonly<Record<string, string | undefined>>;

export type StoredBlob = Readonly<{ url: string; bytes: number }>;

/** Blobs held only in this process (development and tests). */
export const localBlobs = new Map<
  string,
  Readonly<{ contentType: string; body: Uint8Array }>
>();

const LOCAL_BASE = "https://blob.startupshq.test";

/** A year: every variant lives at an immutable path, so a new image means a new URL. */
const CACHE_SECONDS = 31_536_000;

export async function putBlob(
  path: string,
  body: Uint8Array,
  contentType: string,
  env: Env = process.env,
): Promise<StoredBlob> {
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    if (env.NODE_ENV === "production") {
      throw new Error("BLOB_READ_WRITE_TOKEN must be set in production.");
    }
    localBlobs.set(path, { contentType, body });
    return { url: `${LOCAL_BASE}/${path}`, bytes: body.byteLength };
  }

  const stored = await put(path, Buffer.from(body), {
    access: "public",
    contentType,
    token,
    addRandomSuffix: false,
    cacheControlMaxAge: CACHE_SECONDS,
  });
  return { url: stored.url, bytes: body.byteLength };
}

/** Removes every blob under a prefix; used by the media GC and when a share card is replaced. */
export async function deleteBlobPrefix(
  prefix: string,
  env: Env = process.env,
): Promise<number> {
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    let deleted = 0;
    for (const path of [...localBlobs.keys()]) {
      if (path === prefix || path.startsWith(`${prefix}/`)) {
        localBlobs.delete(path);
        deleted += 1;
      }
    }
    return deleted;
  }

  const { blobs } = await list({ prefix, token });
  if (blobs.length === 0) return 0;
  await del(
    blobs.map((blob) => blob.url),
    { token },
  );
  return blobs.length;
}
