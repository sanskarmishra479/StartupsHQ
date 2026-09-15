import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../db/client";
import {
  auditLog,
  batches as batchesTable,
  founders as foundersTable,
  investors as investorsTable,
} from "../db/schema";
import { seed } from "../db/seed";
import {
  ConflictError,
  UnprocessableError,
  ValidationError,
} from "../lib/errors";
import { contexts } from "../testing/authz";
import { fixtureId, found } from "../testing/fixtures";
import { cacheCalls, resetCacheCalls } from "../testing/next-cache";
import { ensureTestUsers } from "../testing/users";
import * as batchWrites from "./batch-writes";
import * as founderWrites from "./founder-writes";
import * as investorWrites from "./investor-writes";
import * as startupReads from "./startups";

// docs/TEST_PLAN.md §6: founder, investor and batch writes. FR-204, FR-405, ADR-019.

const { anonymous, editor } = contexts;

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
    .select({ action: auditLog.action, diff: auditLog.diff })
    .from(auditLog)
    .where(eq(auditLog.entityId, entityId))
    .orderBy(asc(auditLog.createdAt));

describe("founder writes", () => {
  it("creates a draft and audits personal fields by name only (ADR-019)", async () => {
    const created = await founderWrites.create(editor, {
      fullName: "Ines Duarte",
      headline: "Founder of Lumen",
      bio: "Built two robotics companies.",
    });

    expect(created).toMatchObject({ slug: "ines-duarte", status: "draft" });
    const [row] = await auditFor(created.id);
    expect(row?.diff).toEqual({
      fullName: { changed: true },
      headline: { changed: true },
      bio: { changed: true },
      slug: { changed: true },
    });
    expect(JSON.stringify(row?.diff)).not.toMatch(/ines|lumen|robotics/i);
  });

  it("asks for a slug when the name has no Latin characters", async () => {
    await expect(
      founderWrites.create(editor, { fullName: "山田 太郎" }),
    ).rejects.toBeInstanceOf(UnprocessableError);
    expect(
      (
        await founderWrites.create(editor, {
          fullName: "山田 太郎",
          slug: "yamada-taro",
        })
      ).slug,
    ).toBe("yamada-taro");
  });

  it("updates a founder and expires the startup pages that show them", async () => {
    const id = await fixtureId(foundersTable, "mira-okafor");
    await founderWrites.update(editor, id, {
      headline: "CEO at Kiln Analytics",
    });

    const kiln = await found(
      startupReads.getBySlug(anonymous, "kiln-analytics"),
    );
    expect(
      kiln.founders.find((founder) => founder.slug === "mira-okafor")?.headline,
    ).toBe("CEO at Kiln Analytics");
    expect(expired()).toEqual(
      expect.arrayContaining([
        "founder:mira-okafor",
        "startup:kiln-analytics",
        "startup:lanternfish-ai",
        "startup:tidewater-labs",
      ]),
    );
    expect((await auditFor(id)).at(-1)).toEqual({
      action: "update",
      diff: { headline: { changed: true } },
    });
  });

  it("rejects a non-https link", async () => {
    await expect(
      founderWrites.create(editor, {
        fullName: "Link Test",
        personalUrl: "http://example.com",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("investor writes", () => {
  it("creates a draft investor", async () => {
    expect(
      await investorWrites.create(editor, {
        name: "Tessellate Capital",
        investorType: "vc",
      }),
    ).toMatchObject({ slug: "tessellate-capital", status: "draft" });
  });

  it.each<[string, Record<string, unknown>]>([
    ["an unknown investor type", { name: "X", investorType: "hedge_fund" }],
    ["a negative AUM", { name: "X", investorType: "vc", aumUsd: -1 }],
    ["a fractional AUM", { name: "X", investorType: "vc", aumUsd: 1.5 }],
  ])("rejects %s", async (_label, input) => {
    await expect(
      investorWrites.create(editor, input as never),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("expires the batches it runs and the startups it backs", async () => {
    const id = await fixtureId(investorsTable, "parallel-accelerator");
    await investorWrites.update(editor, id, {
      description: "A twelve-week programme.",
    });
    expect(expired()).toEqual(
      expect.arrayContaining([
        "investor:parallel-accelerator",
        "batch:parallel-w25",
        "startup:lanternfish-ai",
        "news",
      ]),
    );
  });
});

describe("batch writes", () => {
  it("generates a slug from program and label", async () => {
    const investorId = await fixtureId(investorsTable, "parallel-accelerator");
    expect(
      await batchWrites.create(editor, {
        investorId,
        programName: "Parallel Accelerator",
        label: "W27",
        year: 2027,
      }),
    ).toMatchObject({ slug: "parallel-accelerator-w27", status: "draft" });

    // The same organizer, label and year is the same batch.
    await expect(
      batchWrites.create(editor, {
        investorId,
        programName: "Parallel Accelerator",
        label: "W27",
        year: 2027,
        slug: "parallel-w27-again",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuses a demo day before the batch starts", async () => {
    await expect(
      batchWrites.create(editor, {
        programName: "Orbit",
        label: "S1",
        year: 2026,
        startsOn: "2026-06-01",
        demoDayOn: "2026-05-01",
      }),
    ).rejects.toBeInstanceOf(UnprocessableError);
  });

  it("rejects a year before 1990", async () => {
    await expect(
      batchWrites.create(editor, {
        programName: "Old",
        label: "A",
        year: 1980,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("expires the cohort's startup pages", async () => {
    const id = await fixtureId(batchesTable, "parallel-w25");
    await batchWrites.update(editor, id, { description: "Winter 2025." });
    expect(expired()).toEqual(
      expect.arrayContaining(["batch:parallel-w25", "startup:lanternfish-ai"]),
    );
  });
});
