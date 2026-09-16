import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../../../server/db/client";
import { seed } from "../../../server/db/seed";
import { PREFILL_LIMIT_PER_HOUR } from "../../../server/services/prefill";
import {
  type CookieJar,
  createTestUser,
  deleteTestUsers,
  signInWithTwoFactor,
} from "../../../server/testing/auth";
import * as contract from "../../../server/testing/contract";
import { POST as prefillRoute } from "./prefill/route";

// docs/API.md §8.6 at the endpoint: who may call it, and that every hostile URL is a refusal.
// The happy path is covered in src/server/services/prefill.test.ts, where the fetcher is injected.

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

const namespace = process.env.RATE_LIMIT_NAMESPACE;
afterEach(() => {
  process.env.RATE_LIMIT_NAMESPACE = namespace;
});

type SendOptions = Readonly<{
  jar?: CookieJar;
  body?: unknown;
  rawBody?: string;
  contentType?: string | null;
  origin?: string | null;
}>;

function send(options: SendOptions): Promise<Response> {
  const headers = new Headers({ host: "admin.startupshq.test" });
  const origin = options.origin === undefined ? ADMIN_ORIGIN : options.origin;
  if (origin !== null) headers.set("origin", origin);
  if (options.jar) headers.set("cookie", options.jar.header());
  const body =
    options.rawBody ??
    (options.body === undefined ? undefined : JSON.stringify(options.body));
  const contentType =
    options.contentType === undefined
      ? body === undefined
        ? null
        : "application/json"
      : options.contentType;
  if (contentType !== null) headers.set("content-type", contentType);

  return prefillRoute(
    new Request(`${ADMIN_ORIGIN}/api/v1/prefill`, {
      method: "POST",
      headers,
      body,
    }),
    { params: Promise.resolve({}) },
  );
}

async function expectError(
  response: Promise<Response>,
  status: number,
  code: string,
) {
  const resolved = await response;
  const text = await resolved.text();
  expect(resolved.status, text).toBe(status);
  const body = contract.errorBody.parse(JSON.parse(text));
  expect(body.error.code).toBe(code);
  return body.error;
}

describe("POST /prefill (§8.6)", () => {
  it.each([
    ["loopback", "https://127.0.0.1/"],
    ["cloud metadata", "https://169.254.169.254/latest/meta-data/"],
    ["a private address", "https://10.0.0.1/"],
    ["plain http", "http://acme-robotics.example/"],
    ["a decimal IP", "https://2130706433/"],
  ])("refuses %s with UNSAFE_URL and no resolved address in the message", async (_label, url) => {
    const error = await expectError(
      send({ jar: editor, body: { url } }),
      400,
      "UNSAFE_URL",
    );
    expect(error.message).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });

  it("validates the body", async () => {
    await expectError(send({ jar: editor, body: {} }), 400, "VALIDATION_ERROR");
    const unknown = await expectError(
      send({ jar: editor, body: { url: "https://x.example/", follow: true } }),
      400,
      "VALIDATION_ERROR",
    );
    expect(unknown.details?.map((detail) => detail.path)).toContain("follow");
  });

  it("needs an editor session, the admin origin and JSON", async () => {
    await expectError(
      send({ body: { url: "https://127.0.0.1/" } }),
      401,
      "UNAUTHORIZED",
    );
    await expectError(
      send({
        jar: editor,
        origin: "https://startupshq.space",
        body: { url: "https://127.0.0.1/" },
      }),
      403,
      "FORBIDDEN",
    );
    await expectError(
      send({ jar: editor, rawBody: "url=x", contentType: "text/plain" }),
      415,
      "UNSUPPORTED_MEDIA_TYPE",
    );
  });

  it("stops after 20 attempts in an hour", async () => {
    process.env.RATE_LIMIT_NAMESPACE = `prefill-endpoint-${randomUUID()}`;
    const attempt = () =>
      send({ jar: editor, body: { url: "https://127.0.0.1/" } });

    for (let index = 0; index < PREFILL_LIMIT_PER_HOUR; index += 1) {
      expect((await attempt()).status).toBe(400);
    }
    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});
