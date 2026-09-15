import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PUBLIC_READ } from "../auth/context";
import { closeDb, getDb } from "../db/client";
import {
  auditLog,
  founders as foundersTable,
  locations,
  startups as startupsTable,
} from "../db/schema";
import { seed } from "../db/seed";
import {
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
} from "../lib/errors";
import { contexts } from "../testing/authz";
import { fixtureId, fixtureRoundId, found } from "../testing/fixtures";
import { cacheCalls, resetCacheCalls } from "../testing/next-cache";
import { ensureTestUsers } from "../testing/users";
import * as founderReads from "./founders";
import { archive, hardDelete, publish, restore, unpublish } from "./lifecycle";
import * as startupWrites from "./startup-writes";
import * as startupReads from "./startups";

// docs/TEST_PLAN.md §6: lifecycle. FR-407, FR-404, FR-405, NFR-02.

const { anonymous, editor, admin } = contexts;
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

/** Tags expired by the last write; every expiry must be immediate. */
function expired(): string[] {
  return cacheCalls
    .filter((call) => call.fn === "revalidateTag")
    .map((call) => {
      expect(call.args[1]).toEqual({ expire: 0 });
      return call.args[0] as string;
    });
}

function auditFor(entityId: string) {
  return getDb()
    .select({
      action: auditLog.action,
      actorId: auditLog.actorId,
      diff: auditLog.diff,
      ip: auditLog.ip,
    })
    .from(auditLog)
    .where(eq(auditLog.entityId, entityId))
    .orderBy(asc(auditLog.createdAt));
}

async function locationId(slug: string): Promise<string> {
  const [row] = await getDb()
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.slug, slug));
  if (!row) throw new Error(`Missing location ${slug}`);
  return row.id;
}

describe("publish", () => {
  it("publishes a draft only once required fields are present", async () => {
    const id = await fixtureId(startupsTable, "stealth-draft-co");

    await expect(publish(editor, "startup", id)).rejects.toThrow(
      "Add a location before publishing.",
    );
    // A refused write leaves no audit row and expires nothing.
    expect(await auditFor(id)).toEqual([]);
    expect(expired()).toEqual([]);

    await startupWrites.update(editor, id, {
      locationId: await locationId("berlin-de"),
    });
    resetCacheCalls();

    expect(await publish(editor, "startup", id)).toEqual({
      id,
      status: "published",
    });
    expect(
      (await found(startupReads.getBySlug(PUBLIC_READ, "stealth-draft-co")))
        .name,
    ).toBe("Stealth Draft Co");
    expect(expired()).toEqual(
      expect.arrayContaining([
        "startup:stealth-draft-co",
        "startups:list",
        "categories",
        "stats",
      ]),
    );
    expect((await auditFor(id)).at(-1)).toEqual({
      action: "publish",
      actorId: editor.actor.id,
      diff: { status: { from: "draft", to: "published" } },
      ip: "203.0.113.51",
    });
  });
});

describe("archive and restore", () => {
  it("hides a startup, expires every neighbour, and keeps the first publication time", async () => {
    const id = await fixtureId(startupsTable, "kiln-analytics");
    const firstPublishedAt = async () =>
      (
        await getDb()
          .select({ at: startupsTable.firstPublishedAt })
          .from(startupsTable)
          .where(eq(startupsTable.id, id))
      )[0]?.at;
    const originallyPublishedAt = await firstPublishedAt();

    expect(await archive(editor, "startup", id)).toEqual({
      id,
      status: "archived",
    });
    await expect(
      startupReads.getBySlug(anonymous, "kiln-analytics"),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(expired()).toEqual(
      expect.arrayContaining([
        "startup:kiln-analytics",
        // its old slug, the company it acquired, its founders and its investors
        "startup:kiln-data",
        "startup:pebble-notes",
        "founder:mira-okafor",
        "founder:tomasz-wrobel",
        "investor:northwind-ventures",
        "investor:harbor-capital",
      ]),
    );

    expect(await restore(editor, "startup", id)).toEqual({
      id,
      status: "draft",
    });
    expect(await publish(editor, "startup", id)).toEqual({
      id,
      status: "published",
    });
    expect(await firstPublishedAt()).toEqual(originallyPublishedAt);
    expect((await auditFor(id)).slice(-3).map((row) => row.action)).toEqual([
      "archive",
      "restore",
      "publish",
    ]);
  });

  it("archives a founder off every startup page", async () => {
    const id = await fixtureId(foundersTable, "tomasz-wrobel");
    await archive(editor, "founder", id);

    await expect(
      founderReads.getBySlug(anonymous, "tomasz-wrobel"),
    ).rejects.toBeInstanceOf(NotFoundError);
    const kiln = await found(
      startupReads.getBySlug(anonymous, "kiln-analytics"),
    );
    expect(kiln.founders.map((founder) => founder.slug)).not.toContain(
      "tomasz-wrobel",
    );
    expect(expired()).toEqual(
      expect.arrayContaining([
        "founder:tomasz-wrobel",
        "startup:kiln-analytics",
      ]),
    );
  });

  it("refuses transitions that make no sense", async () => {
    const archived = await fixtureId(startupsTable, "sunset-legacy");
    const published = await fixtureId(startupsTable, "pebble-notes");

    for (const attempt of [
      () => publish(editor, "startup", archived),
      () => unpublish(editor, "startup", archived),
      () => archive(editor, "startup", archived),
      () => restore(editor, "startup", published),
    ]) {
      await expect(attempt()).rejects.toBeInstanceOf(UnprocessableError);
    }
    expect(expired()).toEqual([]);
  });
});

describe("round status and totals (FR-404)", () => {
  it("counts a round toward totals only while it is published", async () => {
    const seriesB = await fixtureRoundId("solstice-grid", "series_b");
    const solstice = () =>
      found(startupReads.getBySlug(PUBLIC_READ, "solstice-grid"));

    await publish(editor, "round", seriesB);
    expect(await solstice()).toMatchObject({
      totalRaisedUsd: 45_000_000,
      latestRound: { roundType: "series_b", announcedOn: "2026-02-01" },
    });
    expect(expired()).toEqual(
      expect.arrayContaining([
        "startup:solstice-grid",
        "news",
        "startups:list",
      ]),
    );

    await archive(editor, "round", seriesB);
    expect(await solstice()).toMatchObject({
      totalRaisedUsd: 15_000_000,
      latestRound: { roundType: "series_a" },
    });
  });
});

describe("hard delete", () => {
  it("is for admins only", async () => {
    await expect(hardDelete(editor, "startup", NIL)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("refuses a record that was ever published", async () => {
    const id = await fixtureId(startupsTable, "pebble-notes");
    await expect(hardDelete(admin, "startup", id)).rejects.toBeInstanceOf(
      UnprocessableError,
    );
  });

  it("deletes a never-published draft and records it", async () => {
    const draft = await startupWrites.create(admin, {
      name: "Throwaway Draft",
    });
    await hardDelete(admin, "startup", draft.id);

    expect(
      await getDb()
        .select({ id: startupsTable.id })
        .from(startupsTable)
        .where(eq(startupsTable.id, draft.id)),
    ).toEqual([]);
    expect((await auditFor(draft.id)).map((row) => row.action)).toEqual([
      "create",
      "hard_delete",
    ]);
  });
});

describe("unknown targets", () => {
  it.each([
    ["an unknown entity", () => publish(editor, "people", NIL)],
    ["a malformed id", () => archive(editor, "startup", "not-a-uuid")],
    ["a missing record", () => restore(editor, "founder", NIL)],
  ])("is NotFound for %s", async (_label, attempt) => {
    await expect(attempt()).rejects.toBeInstanceOf(NotFoundError);
  });
});
