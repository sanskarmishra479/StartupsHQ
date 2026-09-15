import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../db/client";
import {
  auditLog,
  founders as foundersTable,
  slugRedirects,
  startups as startupsTable,
} from "../db/schema";
import { seed } from "../db/seed";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../lib/errors";
import { contexts } from "../testing/authz";
import { fixtureId, found } from "../testing/fixtures";
import { cacheCalls, resetCacheCalls } from "../testing/next-cache";
import { ensureTestUsers } from "../testing/users";
import { updateCopy } from "./category-writes";
import * as founderReads from "./founders";
import { changeSlug } from "./slug-writes";
import * as startupReads from "./startups";
import { getPage } from "./taxonomy";

// docs/TEST_PLAN.md §6: slug change (FR-409) and category copy (FR-205).

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

const expired = () =>
  cacheCalls
    .filter((call) => call.fn === "revalidateTag")
    .map((call) => call.args[0]);

async function lastAudit(entityId: string) {
  const rows = await getDb()
    .select({ action: auditLog.action, diff: auditLog.diff })
    .from(auditLog)
    .where(eq(auditLog.entityId, entityId))
    .orderBy(asc(auditLog.createdAt));
  return rows.at(-1);
}

async function redirectsTo(entityId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ oldSlug: slugRedirects.oldSlug })
    .from(slugRedirects)
    .where(
      and(
        eq(slugRedirects.entityType, "startup"),
        eq(slugRedirects.entityId, entityId),
      ),
    );
  return rows.map((row) => row.oldSlug).sort();
}

describe("slug change (FR-409)", () => {
  it("is for admins only", async () => {
    await expect(
      changeSlug(editor, "startup", NIL, { slug: "anything" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("moves an entity to a new slug and redirects every old one to it", async () => {
    const id = await fixtureId(startupsTable, "kiln-analytics");

    expect(
      await changeSlug(admin, "startup", id, { slug: "kiln-insights" }),
    ).toEqual({ id, slug: "kiln-insights" });

    expect(
      (await found(startupReads.getBySlug(anonymous, "kiln-insights"))).name,
    ).toBe("Kiln Analytics");
    // Both the previous slug and the older one answer with the current slug: no chains.
    for (const old of ["kiln-analytics", "kiln-data"]) {
      expect(await startupReads.getBySlug(anonymous, old)).toEqual({
        kind: "redirect",
        slug: "kiln-insights",
      });
    }
    expect(await redirectsTo(id)).toEqual(["kiln-analytics", "kiln-data"]);
    expect(expired()).toEqual(
      expect.arrayContaining([
        "startup:kiln-analytics",
        "startup:kiln-insights",
        "startup:kiln-data",
        "founder:mira-okafor",
      ]),
    );
    expect(await lastAudit(id)).toEqual({
      action: "slug_change",
      diff: { slug: { from: "kiln-analytics", to: "kiln-insights" } },
    });
  });

  it("can move back to one of the entity's own old slugs", async () => {
    const id = await fixtureId(startupsTable, "kiln-insights");
    await changeSlug(admin, "startup", id, { slug: "kiln-analytics" });

    expect(await redirectsTo(id)).toEqual(["kiln-data", "kiln-insights"]);
    expect(await startupReads.getBySlug(anonymous, "kiln-insights")).toEqual({
      kind: "redirect",
      slug: "kiln-analytics",
    });
  });

  it("refuses a slug another entity uses or redirects from", async () => {
    const pebble = await fixtureId(startupsTable, "pebble-notes");
    for (const slug of ["driftwood-maps", "kiln-data"]) {
      await expect(
        changeSlug(admin, "startup", pebble, { slug }),
      ).rejects.toBeInstanceOf(ConflictError);
    }
    expect(expired()).toEqual([]);
  });

  it("records a founder's slug change by name only (ADR-019)", async () => {
    const id = await fixtureId(foundersTable, "ruby-walsh");
    await changeSlug(admin, "founder", id, { slug: "ruby-walsh-maps" });

    expect(await lastAudit(id)).toEqual({
      action: "slug_change",
      diff: { slug: { changed: true } },
    });
    expect(await founderReads.getBySlug(anonymous, "ruby-walsh")).toEqual({
      kind: "redirect",
      slug: "ruby-walsh-maps",
    });
  });

  it("does nothing when the slug is unchanged", async () => {
    const id = await fixtureId(startupsTable, "pebble-notes");
    expect(
      await changeSlug(admin, "startup", id, { slug: "pebble-notes" }),
    ).toEqual({ id, slug: "pebble-notes" });
    expect(expired()).toEqual([]);
  });

  it.each<
    [string, () => Promise<unknown>, abstract new (...args: never[]) => Error]
  >([
    [
      "a malformed slug",
      () => changeSlug(admin, "startup", NIL, { slug: "Kiln Data" }),
      ValidationError,
    ],
    [
      "an entity without slugs",
      () => changeSlug(admin, "round", NIL, { slug: "x" }),
      NotFoundError,
    ],
    [
      "a missing record",
      () => changeSlug(admin, "batch", NIL, { slug: "x" }),
      NotFoundError,
    ],
  ])("refuses %s", async (_label, attempt, errorType) => {
    await expect(attempt()).rejects.toBeInstanceOf(errorType);
  });
});

describe("category copy (FR-205)", () => {
  it("adds copy to a facet value that had none", async () => {
    await updateCopy(editor, "work-type", "remote", {
      heading: "Remote-first startups",
      intro: "Teams that work from anywhere.",
    });

    expect(await getPage(anonymous, "work-type", "remote")).toMatchObject({
      heading: "Remote-first startups",
      intro: "Teams that work from anywhere.",
      seoTitle: "Remote-first startups | startupsHQ",
      isGenerated: false,
    });
    expect(expired()).toEqual(
      expect.arrayContaining(["category:work-type:remote", "categories"]),
    );
    const [row] = await getDb()
      .select({ action: auditLog.action, diff: auditLog.diff })
      .from(auditLog)
      .where(eq(auditLog.entityType, "category"));
    expect(row).toMatchObject({
      action: "create",
      diff: { kind: "work-type", slug: "remote" },
    });
  });

  it("changes only the fields it is given", async () => {
    await updateCopy(editor, "industries", "ai", {
      seoDescription: "Every AI company we track.",
    });
    expect(await getPage(anonymous, "industries", "ai")).toMatchObject({
      heading: "AI startups",
      seoDescription: "Every AI company we track.",
    });
  });

  it("clears a field back to its generated fallback", async () => {
    await updateCopy(editor, "industries", "ai", { heading: null });
    expect((await getPage(anonymous, "industries", "ai")).heading).toBe(
      "AI startups",
    );
  });

  it.each<
    [
      string,
      string,
      string,
      Record<string, unknown>,
      abstract new (...args: never[]) => Error,
    ]
  >([
    [
      "a value that does not exist",
      "industries",
      "anything-at-all",
      { heading: "X" },
      NotFoundError,
    ],
    ["an unknown kind", "people", "ai", { heading: "X" }, NotFoundError],
    ["an unknown field", "industries", "ai", { title: "X" }, ValidationError],
    [
      "a non-https icon",
      "industries",
      "ai",
      { iconUrl: "http://example.com/i.svg" },
      ValidationError,
    ],
  ])("refuses %s", async (_label, kind, slug, input, errorType) => {
    await expect(
      updateCopy(editor, kind, slug, input as never),
    ).rejects.toBeInstanceOf(errorType);
  });
});
