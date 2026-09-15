import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../db/client";
import { auditLog, mediaAssets, startups as startupsTable } from "../db/schema";
import { seed } from "../db/seed";
import {
  ConflictError,
  type FieldIssue,
  NotFoundError,
  UnprocessableError,
  ValidationError,
} from "../lib/errors";
import { contexts } from "../testing/authz";
import { fixtureId, found } from "../testing/fixtures";
import { cacheCalls, resetCacheCalls } from "../testing/next-cache";
import { ensureTestUsers } from "../testing/users";
import { create, update } from "./startup-writes";
import * as startupReads from "./startups";

// docs/TEST_PLAN.md §6: startup writes. FR-403, FR-405, FR-408, SEC-02.

const { anonymous, editor } = contexts;
const NIL = "00000000-0000-4000-8000-000000000000";

beforeAll(async () => {
  await ensureTestUsers();
  await seed(getDb());
});

beforeEach(() => {
  resetCacheCalls();
});

afterAll(async () => {
  await seed(getDb());
  await closeDb();
});

const expired = () =>
  cacheCalls
    .filter((call) => call.fn === "revalidateTag")
    .map((call) => call.args[0]);

const auditFor = (entityId: string) =>
  getDb()
    .select({
      action: auditLog.action,
      actorId: auditLog.actorId,
      diff: auditLog.diff,
    })
    .from(auditLog)
    .where(eq(auditLog.entityId, entityId))
    .orderBy(asc(auditLog.createdAt));

async function media(blobPrefix: string) {
  const [row] = await getDb()
    .select({ id: mediaAssets.id, state: mediaAssets.state })
    .from(mediaAssets)
    .where(eq(mediaAssets.blobPrefix, blobPrefix));
  if (!row) throw new Error(`Missing media ${blobPrefix}`);
  return row;
}

describe("startup create", () => {
  it("creates an audited draft with a slug from its name", async () => {
    const created = await create(editor, {
      name: "Lumen Robotics",
      tagline: "Light-guided warehouse pickers.",
    });

    expect(created).toEqual({
      id: expect.any(String),
      slug: "lumen-robotics",
      status: "draft",
    });
    await expect(
      startupReads.getBySlug(anonymous, "lumen-robotics"),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await auditFor(created.id)).toEqual([
      {
        action: "create",
        actorId: editor.actor.id,
        diff: {
          name: { from: null, to: "Lumen Robotics" },
          tagline: { from: null, to: "Light-guided warehouse pickers." },
          slug: { from: null, to: "lumen-robotics" },
        },
      },
    ]);
    expect(expired()).toContain("startup:lumen-robotics");
  });

  it("adds a numeric suffix when the name's slug is taken", async () => {
    expect((await create(editor, { name: "Kiln Analytics" })).slug).toBe(
      "kiln-analytics-2",
    );
  });

  it("honours a free explicit slug and refuses a taken or redirecting one", async () => {
    expect(
      (await create(editor, { name: "Lumen Labs", slug: "lumen-labs" })).slug,
    ).toBe("lumen-labs");
    await expect(
      create(editor, { name: "Another", slug: "pebble-notes" }),
    ).rejects.toBeInstanceOf(ConflictError);
    // Still redirects to Kiln Analytics, so old links must keep working.
    await expect(
      create(editor, { name: "Another", slug: "kiln-data" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("asks for a slug when the name has no Latin characters", async () => {
    await expect(
      create(editor, { name: "株式会社テスト" }),
    ).rejects.toBeInstanceOf(UnprocessableError);
    expect(
      (await create(editor, { name: "株式会社テスト", slug: "tesuto-kk" }))
        .slug,
    ).toBe("tesuto-kk");
  });

  it.each<[string, Record<string, unknown>, string]>([
    ["an unknown field", { name: "X", status: "published" }, "status"],
    ["a derived total", { name: "X", totalRaisedUsd: 1 }, "totalRaisedUsd"],
    [
      "an http link",
      { name: "X", websiteUrl: "http://example.com" },
      "websiteUrl",
    ],
    [
      "a javascript: link",
      { name: "X", websiteUrl: "javascript:alert(1)" },
      "websiteUrl",
    ],
    ["a year before 1900", { name: "X", foundedYear: 1850 }, "foundedYear"],
    [
      "a tagline over 120 characters",
      { name: "X", tagline: "x".repeat(121) },
      "tagline",
    ],
    ["a malformed slug", { name: "X", slug: "Not A Slug" }, "slug"],
    ["a blank name", { name: "   " }, "name"],
  ])("rejects %s (SEC-02)", async (_label, input, path) => {
    const error: unknown = await create(editor, input as never).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ValidationError);
    expect(
      ((error as ValidationError).details ?? []).map(
        (issue: FieldIssue) => issue.path,
      ),
    ).toContain(path);
  });
});

describe("startup update", () => {
  it("applies a partial change, audits the old and new value, and expires neighbours", async () => {
    const id = await fixtureId(startupsTable, "pebble-notes");
    const tagline = "Notes that link themselves, now for teams.";

    await update(editor, id, { tagline });

    expect(
      (await found(startupReads.getBySlug(anonymous, "pebble-notes"))).tagline,
    ).toBe(tagline);
    expect((await auditFor(id)).at(-1)).toEqual({
      action: "update",
      actorId: editor.actor.id,
      diff: { tagline: { from: "Notes that link themselves.", to: tagline } },
    });
    expect(expired()).toEqual(
      expect.arrayContaining([
        "startup:pebble-notes",
        "founder:jose-nunez",
        "investor:meridian-angels",
        "startups:list",
      ]),
    );
  });

  it("writes and expires nothing when nothing changes", async () => {
    const id = await fixtureId(startupsTable, "driftwood-maps");
    const before = (await auditFor(id)).length;
    await update(editor, id, { tagline: "Offline maps for field teams." });
    expect((await auditFor(id)).length).toBe(before);
    expect(expired()).toEqual([]);
  });

  it.each<
    [string, () => Promise<unknown>, abstract new (...args: never[]) => Error]
  >([
    [
      "a slug change",
      async () =>
        update(editor, await fixtureId(startupsTable, "pebble-notes"), {
          slug: "pebble",
        } as never),
      UnprocessableError,
    ],
    [
      "a missing startup",
      () => update(editor, NIL, { tagline: "x" }),
      NotFoundError,
    ],
    [
      "a malformed id",
      () => update(editor, "abc", { tagline: "x" }),
      NotFoundError,
    ],
    [
      "an unknown location",
      async () =>
        update(editor, await fixtureId(startupsTable, "pebble-notes"), {
          locationId: NIL,
        }),
      UnprocessableError,
    ],
    [
      "a founding date outside the founding year",
      async () =>
        update(editor, await fixtureId(startupsTable, "pebble-notes"), {
          foundedOn: "2020-05-01",
        }),
      UnprocessableError,
    ],
  ])("refuses %s", async (_label, attempt, errorType) => {
    await expect(attempt()).rejects.toBeInstanceOf(errorType);
  });
});

describe("media attachment (FR-408)", () => {
  it("attaches a staging image and refuses images it may not use", async () => {
    const fresh = await media("fixtures/fresh-staging");
    const pebble = await fixtureId(startupsTable, "pebble-notes");
    const driftwood = await fixtureId(startupsTable, "driftwood-maps");

    await update(editor, pebble, { coverAssetId: fresh.id });
    expect((await media("fixtures/fresh-staging")).state).toBe("attached");

    const refused = [
      // already attached to Pebble Notes
      { coverAssetId: fresh.id },
      // uploaded as a cover, not a logo
      { logoAssetId: (await media("fixtures/stale-staging")).id },
      // attached, and no longer referenced by anyone
      { logoAssetId: (await media("fixtures/orphaned-attached")).id },
      // does not exist
      { logoAssetId: NIL },
    ];
    for (const change of refused) {
      await expect(update(editor, driftwood, change)).rejects.toBeInstanceOf(
        UnprocessableError,
      );
    }
  });
});
