import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { closeDb, getDb } from "../../../server/db/client";
import { seed } from "../../../server/db/seed";
import { MAX_UPLOAD_BYTES } from "../../../server/services/media";
import {
  type CookieJar,
  createTestUser,
  deleteTestUsers,
  signInWithTwoFactor,
} from "../../../server/testing/auth";
import * as contract from "../../../server/testing/contract";
import { POST as upload } from "./media/route";

// docs/API.md §8.5 contract tests: the multipart endpoint, its refusals, and the DTO it returns.

const ADMIN_ORIGIN = "https://admin.startupshq.test";

let editor: CookieJar;

beforeAll(async () => {
  await seed(getDb());
  editor = await signInWithTwoFactor((await createTestUser("editor")).email);
});

afterAll(async () => {
  await deleteTestUsers();
  await closeDb();
});

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: "#224466" } })
    .png()
    .toBuffer();

type SendOptions = Readonly<{
  jar?: CookieJar;
  origin?: string | null;
  body: FormData | string;
  contentType?: string;
}>;

function send(options: SendOptions): Promise<Response> {
  const headers = new Headers({ host: "admin.startupshq.test" });
  const origin = options.origin === undefined ? ADMIN_ORIGIN : options.origin;
  if (origin !== null) headers.set("origin", origin);
  if (options.jar) headers.set("cookie", options.jar.header());
  if (typeof options.body === "string") {
    headers.set("content-type", options.contentType ?? "application/json");
  }
  return upload(
    new Request(`${ADMIN_ORIGIN}/api/v1/media`, {
      method: "POST",
      headers,
      body: options.body,
    }),
    { params: Promise.resolve({}) },
  );
}

/** A File needs its own ArrayBuffer; a Node Buffer's may be shared. */
function ownBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

async function form(
  bytes: Uint8Array,
  purpose: string,
  filename = "logo.png",
): Promise<FormData> {
  const data = new FormData();
  data.set(
    "file",
    new File([ownBuffer(bytes)], filename, { type: "image/png" }),
  );
  data.set("purpose", purpose);
  return data;
}

async function read<S extends z.ZodType>(
  response: Promise<Response>,
  schema: S,
  status = 200,
): Promise<z.output<S>> {
  const resolved = await response;
  const text = await resolved.text();
  expect(resolved.status, text).toBe(status);
  const parsed = schema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
  return parsed.data;
}

async function expectError(
  response: Promise<Response>,
  status: number,
  code: string,
) {
  const body = await read(response, contract.errorBody, status);
  expect(body.error.code).toBe(code);
}

const uploaded = contract.single(
  z.strictObject({
    assetId: z.uuid(),
    state: z.literal("staging"),
    purpose: z.enum(["logo", "cover", "photo"]),
    image: contract.image,
  }),
);

describe("POST /media (§8.5)", () => {
  it("stores an editor's image and answers with the asset", async () => {
    const { data } = await read(
      send({ jar: editor, body: await form(await png(400, 400), "logo") }),
      uploaded,
      201,
    );
    expect(data.image.variants.map((variant) => variant.width)).toEqual([
      64, 128, 256,
    ]);
    expect(data.image.url).toBe(data.image.variants.at(-1)?.url);
  });

  it("refuses anything but multipart", async () => {
    await expectError(
      send({ jar: editor, body: JSON.stringify({ purpose: "logo" }) }),
      415,
      "UNSUPPORTED_MEDIA_TYPE",
    );
  });

  it("needs a file and a known purpose", async () => {
    const withoutFile = new FormData();
    withoutFile.set("purpose", "logo");
    await expectError(
      send({ jar: editor, body: withoutFile }),
      400,
      "VALIDATION_ERROR",
    );
    await expectError(
      send({ jar: editor, body: await form(await png(64, 64), "banner") }),
      400,
      "VALIDATION_ERROR",
    );
  });

  it("refuses an image over 5 MB", async () => {
    const oversized = Buffer.alloc(MAX_UPLOAD_BYTES + 1024, 3);
    await expectError(
      send({ jar: editor, body: await form(oversized, "cover") }),
      413,
      "PAYLOAD_TOO_LARGE",
    );
  });

  it("refuses an SVG, whatever it is named", async () => {
    const data = new FormData();
    data.set(
      "file",
      new File(
        ['<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>'],
        "logo.png",
        { type: "image/png" },
      ),
    );
    data.set("purpose", "logo");
    await expectError(
      send({ jar: editor, body: data }),
      415,
      "UNSUPPORTED_MEDIA_TYPE",
    );
  });

  it("needs a session and the admin origin", async () => {
    await expectError(
      send({ body: await form(await png(64, 64), "logo") }),
      401,
      "UNAUTHORIZED",
    );
    await expectError(
      send({
        jar: editor,
        origin: "https://startupshq.space",
        body: await form(await png(64, 64), "logo"),
      }),
      403,
      "FORBIDDEN",
    );
  });
});
