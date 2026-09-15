import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { proxy } from "../../../proxy";
import { closeDb, getDb } from "../../../server/db/client";
import { industries, locations } from "../../../server/db/schema";
import { seed } from "../../../server/db/seed";
import { MAX_JSON_BODY_BYTES } from "../../../server/http/authed";
import type { RouteHandler } from "../../../server/http/handler";
import {
  authPost,
  CookieJar,
  createTestUser,
  deleteTestUsers,
  signInWithTwoFactor,
  TEST_PASSWORD,
} from "../../../server/testing/auth";
import * as contract from "../../../server/testing/contract";
import {
  fixtureId,
  startups as startupsTable,
} from "../../../server/testing/fixtures";
import * as batchPublish from "./batches/[slug]/publish/route";
import * as batchItem from "./batches/[slug]/route";
import * as batchCollection from "./batches/route";
import * as categoryItem from "./categories/[kind]/[slug]/route";
import * as founderErase from "./founders/[slug]/erase/route";
import * as founderPublish from "./founders/[slug]/publish/route";
import * as founderItem from "./founders/[slug]/route";
import * as founderCollection from "./founders/route";
import * as investorPublish from "./investors/[slug]/publish/route";
import * as investorItem from "./investors/[slug]/route";
import * as investorCollection from "./investors/route";
import * as privacyItem from "./privacy/requests/[id]/route";
import * as privacyCollection from "./privacy/requests/route";
import * as roundPublish from "./rounds/[id]/publish/route";
import * as roundItem from "./rounds/[id]/route";
import * as roundCollection from "./rounds/route";
import * as startupBatchItem from "./startups/[slug]/batches/[batchId]/route";
import * as startupBatches from "./startups/[slug]/batches/route";
import * as startupFounderItem from "./startups/[slug]/founders/[linkId]/route";
import * as startupFounders from "./startups/[slug]/founders/route";
import * as startupIndustries from "./startups/[slug]/industries/route";
import * as startupInvestorItem from "./startups/[slug]/investors/[linkId]/route";
import * as startupInvestors from "./startups/[slug]/investors/route";
import * as startupPublish from "./startups/[slug]/publish/route";
import * as startupRestore from "./startups/[slug]/restore/route";
import * as startupItem from "./startups/[slug]/route";
import * as startupSlug from "./startups/[slug]/slug/route";
import * as startupUnpublish from "./startups/[slug]/unpublish/route";
import * as startupCollection from "./startups/route";

// API contract tests for the write and admin endpoints (docs/API.md §8, TEST_PLAN §9, SEC-04),
// driven by real Better Auth sessions that completed TOTP, through the route handlers exactly as
// Next.js calls them.

const ADMIN_ORIGIN = "https://admin.startupshq.test";
const PUBLIC_ORIGIN = "https://startupshq.test";

let editor: CookieJar;
let admin: CookieJar;
let passwordOnly: CookieJar;

beforeAll(async () => {
  await seed(getDb());
  editor = await signInWithTwoFactor((await createTestUser("editor")).email);
  admin = await signInWithTwoFactor((await createTestUser("admin")).email);

  passwordOnly = new CookieJar();
  const { email } = await createTestUser("editor");
  const signedIn = await authPost(
    "/sign-in/email",
    { email, password: TEST_PASSWORD },
    { jar: passwordOnly },
  );
  expect(signedIn.status).toBe(200);
});

afterAll(async () => {
  await deleteTestUsers();
  await closeDb();
});

type SendOptions = Readonly<{
  jar?: CookieJar;
  body?: unknown;
  rawBody?: string;
  /** Defaults to application/json when there is a body; null sends none. */
  contentType?: string | null;
  /** Defaults to the admin origin; null sends none. */
  origin?: string | null;
  secFetchSite?: string;
  params?: Record<string, string>;
}>;

function send(
  route: RouteHandler,
  method: string,
  path: string,
  options: SendOptions = {},
): Promise<Response> {
  const headers = new Headers();
  const origin = options.origin === undefined ? ADMIN_ORIGIN : options.origin;
  if (origin !== null) headers.set("origin", origin);
  if (options.secFetchSite) headers.set("sec-fetch-site", options.secFetchSite);
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

  return route(
    new Request(`${ADMIN_ORIGIN}/api/v1${path}`, { method, headers, body }),
    { params: Promise.resolve(options.params ?? {}) },
  );
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
  return body.error;
}

async function expectNoContent(response: Promise<Response>) {
  const resolved = await response;
  expect(resolved.status, await resolved.text()).toBe(204);
}

const status = z.enum(["draft", "published", "archived"]);
const written = contract.single(
  z.strictObject({ id: z.uuid(), slug: z.string(), status }),
);
const transitioned = contract.single(z.strictObject({ id: z.uuid(), status }));
const linkCreated = contract.single(z.strictObject({ id: z.uuid() }));

const unique = (label: string) => `${label} ${randomUUID().slice(0, 8)}`;

async function locationId(slug: string): Promise<string> {
  const [row] = await getDb()
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.slug, slug));
  if (!row) throw new Error(`Missing location ${slug}`);
  return row.id;
}

async function industryId(slug: string): Promise<string> {
  const [row] = await getDb()
    .select({ id: industries.id })
    .from(industries)
    .where(eq(industries.slug, slug));
  if (!row) throw new Error(`Missing industry ${slug}`);
  return row.id;
}

const publicStartup = (slug: string) =>
  startupItem.GET(new Request(`${PUBLIC_ORIGIN}/api/v1/startups/${slug}`), {
    params: Promise.resolve({ slug }),
  });

describe("checks before any write (SEC-03.5, SEC-04)", () => {
  const createStartup = (options: SendOptions) =>
    send(startupCollection.POST, "POST", "/startups", {
      body: { name: unique("Layer Probe") },
      ...options,
    });

  it.each<[string, SendOptions, number, string]>([
    ["without Origin or Fetch Metadata", { origin: null }, 403, "FORBIDDEN"],
    ["from the public origin", { origin: PUBLIC_ORIGIN }, 403, "FORBIDDEN"],
    [
      "from a foreign origin",
      { origin: "https://evil.example" },
      403,
      "FORBIDDEN",
    ],
    [
      "marked cross-site by Fetch Metadata",
      { origin: null, secFetchSite: "cross-site" },
      403,
      "FORBIDDEN",
    ],
    [
      "with a text/plain body",
      { contentType: "text/plain" },
      415,
      "UNSUPPORTED_MEDIA_TYPE",
    ],
    [
      "with a form body",
      { contentType: "application/x-www-form-urlencoded" },
      415,
      "UNSUPPORTED_MEDIA_TYPE",
    ],
  ])("refuses a request %s, even with an editor session", async (_label, options, statusCode, code) => {
    await expectError(
      createStartup({ jar: editor, ...options }),
      statusCode,
      code,
    );
  });

  it("refuses an anonymous caller with 401", async () => {
    await expectError(createStartup({}), 401, "UNAUTHORIZED");
  });

  it("refuses a session that has not completed two-factor with 401", async () => {
    await expectError(
      createStartup({ jar: passwordOnly }),
      401,
      "UNAUTHORIZED",
    );
  });

  it("accepts same-origin Fetch Metadata when Origin is absent", async () => {
    await read(
      createStartup({ jar: editor, origin: null, secFetchSite: "same-origin" }),
      written,
      201,
    );
  });

  it("refuses an editor every admin-only action with 403", async () => {
    const kiln = await fixtureId(startupsTable, "kiln-analytics");
    await expectError(
      send(startupSlug.POST, "POST", `/startups/${kiln}/slug`, {
        jar: editor,
        body: { slug: "kiln-renamed" },
        params: { slug: kiln },
      }),
      403,
      "FORBIDDEN",
    );
    await expectError(
      send(privacyCollection.GET, "GET", "/privacy/requests", { jar: editor }),
      403,
      "FORBIDDEN",
    );
    await expectError(
      send(privacyCollection.POST, "POST", "/privacy/requests", {
        jar: editor,
        body: {},
      }),
      403,
      "FORBIDDEN",
    );

    // Hard delete shares its endpoint with archiving, so the service refuses it (layer 3).
    const draft = await read(createStartup({ jar: editor }), written, 201);
    await expectError(
      send(
        startupItem.DELETE,
        "DELETE",
        `/startups/${draft.data.id}?hard=true`,
        {
          jar: editor,
          params: { slug: draft.data.id },
        },
      ),
      403,
      "FORBIDDEN",
    );
  });

  it("answers write paths on the public origin with 404 (layer 1)", () => {
    for (const [method, path] of [
      ["POST", "/api/v1/startups"],
      ["PATCH", `/api/v1/startups/${randomUUID()}`],
      ["DELETE", `/api/v1/founders/${randomUUID()}`],
      ["PUT", `/api/v1/startups/${randomUUID()}/industries`],
    ] as const) {
      const response = proxy(
        new NextRequest(`${PUBLIC_ORIGIN}${path}`, {
          method,
          headers: { host: "startupshq.test" },
        }),
      );
      expect(response.status, `${method} ${path}`).toBe(404);
    }
  });

  it("rejects malformed JSON, unknown fields and oversized bodies", async () => {
    const invalid = await expectError(
      createStartup({ jar: editor, rawBody: "{" }),
      400,
      "VALIDATION_ERROR",
    );
    expect(invalid.details).toEqual([
      { path: "(root)", message: "The body must be valid JSON." },
    ]);

    const unknown = await expectError(
      createStartup({
        jar: editor,
        body: { name: unique("Sneaky"), status: "published" },
      }),
      400,
      "VALIDATION_ERROR",
    );
    expect(unknown.details?.map((detail) => detail.path)).toContain("status");

    await expectError(
      createStartup({
        jar: editor,
        rawBody: JSON.stringify({ name: "x".repeat(MAX_JSON_BODY_BYTES) }),
      }),
      413,
      "PAYLOAD_TOO_LARGE",
    );
  });

  it("answers an id that cannot exist with 404, and a slug edit with 422", async () => {
    await expectError(
      send(startupItem.PATCH, "PATCH", "/startups/kiln-analytics", {
        jar: editor,
        body: { tagline: "No." },
        params: { slug: "kiln-analytics" },
      }),
      404,
      "NOT_FOUND",
    );
    const unknownId = randomUUID();
    await expectError(
      send(startupPublish.POST, "POST", `/startups/${unknownId}/publish`, {
        jar: editor,
        params: { slug: unknownId },
      }),
      404,
      "NOT_FOUND",
    );

    const kiln = await fixtureId(startupsTable, "kiln-analytics");
    await expectError(
      send(startupItem.PATCH, "PATCH", `/startups/${kiln}`, {
        jar: editor,
        body: { slug: "kiln" },
        params: { slug: kiln },
      }),
      422,
      "UNPROCESSABLE",
    );
  });

  it("marks admin responses private and never stored", async () => {
    const response = await createStartup({});
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("a startup's lifecycle over HTTP (§8.1, §8.2)", () => {
  it("creates, edits, publishes, renames, archives and restores", async () => {
    const created = await read(
      send(startupCollection.POST, "POST", "/startups", {
        jar: editor,
        body: {
          name: unique("Harbor Lights"),
          tagline: "Lighthouse telemetry.",
          locationId: await locationId("berlin-de"),
          industries: [{ id: await industryId("climate"), isPrimary: true }],
        },
      }),
      written,
      201,
    );
    const { id, slug } = created.data;
    const params = { slug: id };
    expect(created.data.status).toBe("draft");
    await expectError(publicStartup(slug), 404, "NOT_FOUND");

    const updated = await read(
      send(startupItem.PATCH, "PATCH", `/startups/${id}`, {
        jar: editor,
        body: { tagline: "Telemetry for lighthouses." },
        params,
      }),
      written,
    );
    expect(updated.data).toEqual({ id, slug, status: "draft" });

    const published = await read(
      send(startupPublish.POST, "POST", `/startups/${id}/publish`, {
        jar: editor,
        params,
      }),
      transitioned,
    );
    expect(published.data).toEqual({ id, status: "published" });
    const visible = await read(
      publicStartup(slug),
      contract.single(contract.startup),
    );
    expect(visible.data.tagline).toBe("Telemetry for lighthouses.");

    const renamed = await read(
      send(startupSlug.POST, "POST", `/startups/${id}/slug`, {
        jar: admin,
        body: { slug: `${slug}-co` },
        params,
      }),
      contract.single(z.strictObject({ id: z.uuid(), slug: z.string() })),
    );
    expect(renamed.data.slug).toBe(`${slug}-co`);
    const redirect = await publicStartup(slug);
    expect(redirect.status).toBe(301);
    expect(redirect.headers.get("location")).toBe(
      `${PUBLIC_ORIGIN}/api/v1/startups/${slug}-co`,
    );

    await expectNoContent(
      send(startupItem.DELETE, "DELETE", `/startups/${id}`, {
        jar: editor,
        params,
      }),
    );
    await expectError(publicStartup(`${slug}-co`), 404, "NOT_FOUND");
    // Once published, a record can only ever be archived.
    await expectError(
      send(startupItem.DELETE, "DELETE", `/startups/${id}?hard=true`, {
        jar: admin,
        params,
      }),
      422,
      "UNPROCESSABLE",
    );

    const restored = await read(
      send(startupRestore.POST, "POST", `/startups/${id}/restore`, {
        jar: editor,
        params,
      }),
      transitioned,
    );
    expect(restored.data.status).toBe("draft");
    await read(
      send(startupPublish.POST, "POST", `/startups/${id}/publish`, {
        jar: editor,
        params,
      }),
      transitioned,
    );
    const unpublished = await read(
      send(startupUnpublish.POST, "POST", `/startups/${id}/unpublish`, {
        jar: editor,
        params,
      }),
      transitioned,
    );
    expect(unpublished.data.status).toBe("draft");
  });

  it("refuses to publish a startup without a tagline and location", async () => {
    const created = await read(
      send(startupCollection.POST, "POST", "/startups", {
        jar: editor,
        body: { name: unique("Bare") },
      }),
      written,
      201,
    );
    await expectError(
      send(
        startupPublish.POST,
        "POST",
        `/startups/${created.data.id}/publish`,
        {
          jar: editor,
          params: { slug: created.data.id },
        },
      ),
      422,
      "UNPROCESSABLE",
    );
  });

  it("hard-deletes a never-published draft, for an admin", async () => {
    const created = await read(
      send(startupCollection.POST, "POST", "/startups", {
        jar: editor,
        body: { name: unique("Mistake") },
      }),
      written,
      201,
    );
    const params = { slug: created.data.id };
    await expectNoContent(
      send(
        startupItem.DELETE,
        "DELETE",
        `/startups/${created.data.id}?hard=true`,
        {
          jar: admin,
          params,
        },
      ),
    );
    await expectError(
      send(startupItem.PATCH, "PATCH", `/startups/${created.data.id}`, {
        jar: editor,
        body: { tagline: "Gone." },
        params,
      }),
      404,
      "NOT_FOUND",
    );
  });
});

describe("founders, investors, batches and rounds (§8.1)", () => {
  it.each<
    [
      string,
      RouteHandler,
      RouteHandler,
      RouteHandler,
      RouteHandler,
      () => Record<string, unknown>,
      Record<string, unknown>,
    ]
  >([
    [
      "founders",
      founderCollection.POST,
      founderItem.PATCH,
      founderPublish.POST,
      founderItem.DELETE,
      () => ({ fullName: unique("Probe Founder") }),
      { headline: "Builds things." },
    ],
    [
      "investors",
      investorCollection.POST,
      investorItem.PATCH,
      investorPublish.POST,
      investorItem.DELETE,
      () => ({ name: unique("Probe Capital"), investorType: "vc" }),
      { description: "A seed fund." },
    ],
    [
      "batches",
      batchCollection.POST,
      batchItem.PATCH,
      batchPublish.POST,
      batchItem.DELETE,
      () => ({ programName: unique("Probe Program"), label: "P1", year: 2025 }),
      { description: "The first cohort." },
    ],
  ])("creates, edits, publishes and archives %s", async (collection, create, update, publish, remove, body, patch) => {
    const created = await read(
      send(create, "POST", `/${collection}`, { jar: editor, body: body() }),
      written,
      201,
    );
    const { id } = created.data;
    const params = { slug: id };
    await read(
      send(update, "PATCH", `/${collection}/${id}`, {
        jar: editor,
        body: patch,
        params,
      }),
      written,
    );
    const published = await read(
      send(publish, "POST", `/${collection}/${id}/publish`, {
        jar: editor,
        params,
      }),
      transitioned,
    );
    expect(published.data.status).toBe("published");
    await expectNoContent(
      send(remove, "DELETE", `/${collection}/${id}`, { jar: editor, params }),
    );
  });

  it("creates a round without accepting client-computed amounts", async () => {
    const startupId = await fixtureId(startupsTable, "kiln-analytics");
    const round = {
      startupId,
      roundType: "grant",
      announcedOn: "2024-02-29",
      currency: "USD",
      amountOriginal: 150_000,
      sourceUrl: "https://example.com/kiln-grant",
    };
    await expectError(
      send(roundCollection.POST, "POST", "/rounds", {
        jar: editor,
        body: { ...round, amountUsd: 150_000 },
      }),
      400,
      "VALIDATION_ERROR",
    );

    const roundWritten = contract.single(
      z.strictObject({ id: z.uuid(), status }),
    );
    const created = await read(
      send(roundCollection.POST, "POST", "/rounds", {
        jar: editor,
        body: round,
      }),
      roundWritten,
      201,
    );
    const { id } = created.data;
    const params = { id };
    await read(
      send(roundItem.PATCH, "PATCH", `/rounds/${id}`, {
        jar: editor,
        body: { sourceTitle: "Kiln wins a research grant" },
        params,
      }),
      roundWritten,
    );
    await read(
      send(roundPublish.POST, "POST", `/rounds/${id}/publish`, {
        jar: editor,
        params,
      }),
      transitioned,
    );
    await expectNoContent(
      send(roundItem.DELETE, "DELETE", `/rounds/${id}`, {
        jar: editor,
        params,
      }),
    );
  });
});

describe("startup relationships (§8.3)", () => {
  it("links and unlinks founders, investors, batches and industries", async () => {
    const create = (route: RouteHandler, path: string, body: object) =>
      read(send(route, "POST", path, { jar: editor, body }), written, 201);
    const startup = await create(startupCollection.POST, "/startups", {
      name: unique("Link Probe"),
    });
    const founder = await create(founderCollection.POST, "/founders", {
      fullName: unique("Link Founder"),
    });
    const investor = await create(investorCollection.POST, "/investors", {
      name: unique("Link Capital"),
      investorType: "angel",
    });
    const batch = await create(batchCollection.POST, "/batches", {
      programName: unique("Link Program"),
      label: "L1",
      year: 2025,
    });
    const id = startup.data.id;
    const base = `/startups/${id}`;
    const params = { slug: id };

    const stint = {
      founderId: founder.data.id,
      role: "cofounder",
      joinedYear: 2021,
    };
    const link = await read(
      send(startupFounders.POST, "POST", `${base}/founders`, {
        jar: editor,
        body: stint,
        params,
      }),
      linkCreated,
      201,
    );
    await expectError(
      send(startupFounders.POST, "POST", `${base}/founders`, {
        jar: editor,
        body: stint,
        params,
      }),
      409,
      "CONFLICT",
    );
    await expectError(
      send(startupFounders.POST, "POST", `${base}/founders`, {
        jar: editor,
        body: { ...stint, role: "advisor", leftYear: 2020 },
        params,
      }),
      422,
      "UNPROCESSABLE",
    );
    const founderLink = { ...params, linkId: link.data.id };
    await expectNoContent(
      send(
        startupFounderItem.DELETE,
        "DELETE",
        `${base}/founders/${link.data.id}`,
        {
          jar: editor,
          params: founderLink,
        },
      ),
    );
    await expectError(
      send(
        startupFounderItem.DELETE,
        "DELETE",
        `${base}/founders/${link.data.id}`,
        {
          jar: editor,
          params: founderLink,
        },
      ),
      404,
      "NOT_FOUND",
    );

    const backer = { investorId: investor.data.id, isLead: true };
    const backing = await read(
      send(startupInvestors.POST, "POST", `${base}/investors`, {
        jar: editor,
        body: backer,
        params,
      }),
      linkCreated,
      201,
    );
    await expectError(
      send(startupInvestors.POST, "POST", `${base}/investors`, {
        jar: editor,
        body: backer,
        params,
      }),
      409,
      "CONFLICT",
    );
    await expectNoContent(
      send(
        startupInvestorItem.DELETE,
        "DELETE",
        `${base}/investors/${backing.data.id}`,
        { jar: editor, params: { ...params, linkId: backing.data.id } },
      ),
    );

    const cohort = { batchId: batch.data.id };
    await expectNoContent(
      send(startupBatches.POST, "POST", `${base}/batches`, {
        jar: editor,
        body: cohort,
        params,
      }),
    );
    await expectError(
      send(startupBatches.POST, "POST", `${base}/batches`, {
        jar: editor,
        body: cohort,
        params,
      }),
      409,
      "CONFLICT",
    );
    await expectNoContent(
      send(
        startupBatchItem.DELETE,
        "DELETE",
        `${base}/batches/${batch.data.id}`,
        {
          jar: editor,
          params: { ...params, batchId: batch.data.id },
        },
      ),
    );

    const [ai, climate] = await Promise.all([
      industryId("ai"),
      industryId("climate"),
    ]);
    await expectError(
      send(startupIndustries.PUT, "PUT", `${base}/industries`, {
        jar: editor,
        body: {
          industries: [
            { id: ai, isPrimary: true },
            { id: climate, isPrimary: true },
          ],
        },
        params,
      }),
      422,
      "UNPROCESSABLE",
    );
    await expectNoContent(
      send(startupIndustries.PUT, "PUT", `${base}/industries`, {
        jar: editor,
        body: { industries: [{ id: ai, isPrimary: true }, { id: climate }] },
        params,
      }),
    );
  });
});

describe("category copy (§8.4)", () => {
  it("edits copy for an existing facet value only", async () => {
    const edit = (kind: string, slug: string, body: object) =>
      send(categoryItem.PATCH, "PATCH", `/categories/${kind}/${slug}`, {
        jar: editor,
        body,
        params: { kind, slug },
      });

    await expectNoContent(
      edit("industries", "fintech", { heading: "Fintech companies to watch" }),
    );
    const page = await read(
      categoryItem.GET(
        new Request(`${PUBLIC_ORIGIN}/api/v1/categories/industries/fintech`),
        { params: Promise.resolve({ kind: "industries", slug: "fintech" }) },
      ),
      contract.single(contract.categoryPage),
    );
    expect(page.data.heading).toBe("Fintech companies to watch");

    await expectError(
      edit("industries", "anything-at-all", { heading: "Nope" }),
      404,
      "NOT_FOUND",
    );
    await expectError(
      edit("industries", "fintech", { headline: "Wrong field" }),
      400,
      "VALIDATION_ERROR",
    );
  });
});

describe("privacy (§8.9, admin only)", () => {
  it("records, lists and resolves a request", async () => {
    const receivedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const created = await read(
      send(privacyCollection.POST, "POST", "/privacy/requests", {
        jar: admin,
        body: { requestType: "access", subjectEntityType: "other", receivedAt },
      }),
      contract.single(z.object({ id: z.uuid(), status: z.literal("open") })),
      201,
    );
    const { id } = created.data;

    const open = await read(
      send(privacyCollection.GET, "GET", "/privacy/requests?status=open", {
        jar: admin,
        origin: null,
      }),
      contract.single(z.array(z.object({ id: z.uuid() }))),
    );
    expect(open.data.map((request) => request.id)).toContain(id);
    await expectError(
      send(privacyCollection.GET, "GET", "/privacy/requests?status=pending", {
        jar: admin,
      }),
      400,
      "VALIDATION_ERROR",
    );

    const resolve = () =>
      send(privacyItem.PATCH, "PATCH", `/privacy/requests/${id}`, {
        jar: admin,
        body: { status: "completed" },
        params: { id },
      });
    await read(
      resolve(),
      contract.single(z.object({ status: z.literal("completed") })),
    );
    await expectError(resolve(), 422, "UNPROCESSABLE");
  });

  it("erases a founder only with the exact confirmation", async () => {
    const founder = await read(
      send(founderCollection.POST, "POST", "/founders", {
        jar: admin,
        body: { fullName: unique("Erase Probe") },
      }),
      written,
      201,
    );
    const { id, slug } = founder.data;
    const erase = (confirm: string) =>
      send(founderErase.POST, "POST", `/founders/${id}/erase`, {
        jar: admin,
        body: { confirm },
        params: { slug: id },
      });

    await expectError(erase("ERASE someone-else"), 422, "UNPROCESSABLE");
    const erased = await read(
      erase(`ERASE ${slug}`),
      contract.single(z.strictObject({ scrubbedAuditRows: z.int().min(1) })),
    );
    expect(erased.data.scrubbedAuditRows).toBeGreaterThanOrEqual(1);
    await expectError(erase(`ERASE ${slug}`), 404, "NOT_FOUND");
  });
});
