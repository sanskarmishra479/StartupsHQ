import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PUBLIC_READ } from "../auth/context";
import { closeDb, getDb } from "../db/client";
import { seed } from "../db/seed";
import { contexts } from "../testing/authz";
import { listSlugs } from "./slugs";

// Slug listings for prerendering and the sitemap (FR-110).

beforeAll(async () => {
  await seed(getDb());
});

afterAll(async () => {
  await closeDb();
});

describe("slugs.listSlugs", () => {
  it("lists published startups only, alphabetically", async () => {
    const slugs = await listSlugs(PUBLIC_READ, "startup");
    expect(slugs).toHaveLength(17);
    expect(slugs).toEqual([...slugs].sort());
    expect(slugs).not.toContain("stealth-draft-co");
    expect(slugs).not.toContain("sunset-legacy");
    expect(await listSlugs(contexts.editor, "startup")).toContain(
      "stealth-draft-co",
    );
  });

  it.each([
    "founder",
    "investor",
    "batch",
  ] as const)("lists %s slugs", async (entity) => {
    expect((await listSlugs(PUBLIC_READ, entity)).length).toBeGreaterThan(0);
  });

  it("caps the list", async () => {
    expect(await listSlugs(PUBLIC_READ, "startup", 2)).toHaveLength(2);
  });

  it("hides archived investors", async () => {
    expect(await listSlugs(PUBLIC_READ, "investor")).not.toContain(
      "old-mill-ventures",
    );
  });
});
