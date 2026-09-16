import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../db/client";
import {
  auditLog,
  founders,
  importJobs,
  industries,
  investors,
  startupIndustries,
  startups,
} from "../db/schema";
import { seed } from "../db/seed";
import {
  ConflictError,
  NotFoundError,
  UnprocessableError,
} from "../lib/errors";
import { contexts } from "../testing/authz";
import { ensureTestUsers } from "../testing/users";
import { commit, dryRun, exportReport, MAX_IMPORT_ROWS } from "./import";

// docs/TEST_PLAN.md §8 SEC-07 and FR-402: the dry run is the only thing that reads the file, and
// commit applies the stored plan in one transaction or writes nothing at all.

const editor = contexts.editor;

beforeAll(async () => {
  await seed(getDb());
  await ensureTestUsers();
});

afterAll(async () => {
  await closeDb();
});

const HEADER =
  "name,slug,tagline,websiteUrl,stage,workType,foundedYear,location,industries,founders,investors";

const file = (...lines: string[]) => Buffer.from([HEADER, ...lines].join("\n"));

const countStartups = async () => {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(startups);
  return row?.count ?? 0;
};

const jobStatus = async (id: string) => {
  const [row] = await getDb()
    .select({ status: importJobs.status })
    .from(importJobs)
    .where(eq(importJobs.id, id));
  return row?.status;
};

describe("the dry run plans every row (FR-402)", () => {
  it("creates, updates, skips duplicates and reports bad rows", async () => {
    const result = await dryRun(editor, {
      filename: "companies.csv",
      bytes: file(
        "Northwind Looms,,Textile automation.,https://northwind-looms.example/,seed,hybrid,2021,berlin-de,devtools,Ada Weaver,Northwind Ventures;Parkway VC",
        // An explicit slug naming a record we hold is the only way to change one.
        "Kiln Analytics Renamed,kiln-analytics,Now with a new tagline.,,,,,,,,",
        // No slug column, but the name derives one we already hold.
        "Pebble Notes,,A company we already hold under this name.,,,,,,,,",
        // A different slug, but close enough in name that a person should decide.
        "Kiln Analytics AI,,Nearly the same name.,,,,,,,,",
        "Glasshouse Grocers,,Indoor farms.,https://glasshouse.example/,pre_seed,onsite,2023,london-gb,nosuchindustry,,",
        "Northwind Looms,,A repeat of row 1.,,,,,,,,",
        ",,A row with no name at all.,,,,,,,,",
      ),
    });

    expect(result.rowCount).toBe(7);
    expect(result.summary).toEqual({ create: 1, update: 1, skip: 3, error: 2 });

    const byRow = new Map(result.rows.map((row) => [row.row, row]));
    expect(byRow.get(1)?.action).toBe("create");
    expect(byRow.get(2)).toMatchObject({
      action: "update",
      slug: "kiln-analytics",
    });
    expect(byRow.get(3)?.reason).toBe("Duplicate: slug 'pebble-notes' exists");
    expect(byRow.get(4)?.reason).toMatch(
      /Possible duplicate of 'Kiln Analytics' \(similarity 0\.88\)/,
    );
    expect(byRow.get(5)?.errors?.[0]).toMatchObject({ path: "industries" });
    // Two rows in one file naming the same company: the second is reported, not applied twice.
    expect(byRow.get(6)?.reason).toMatch(/earlier row in this file/);
    expect(byRow.get(7)?.errors?.[0]).toMatchObject({ path: "name" });

    // Names nobody holds yet are flagged, so an editor knows what the import would create;
    // Northwind Ventures already exists and is reused rather than duplicated.
    expect(result.newFounders).toEqual(["Ada Weaver"]);
    expect(result.newInvestors).toEqual(["Parkway VC"]);
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("refuses a file with more rows than an import may carry", async () => {
    const rows = Array.from(
      { length: MAX_IMPORT_ROWS + 1 },
      (_, index) => `Company Number ${index},,,,,,,,,,`,
    );
    await expect(
      dryRun(editor, { filename: "big.csv", bytes: file(...rows) }),
    ).rejects.toBeInstanceOf(UnprocessableError);
  });

  it("refuses an empty file and one with only a header", async () => {
    await expect(
      dryRun(editor, { filename: "empty.csv", bytes: Buffer.from("") }),
    ).rejects.toThrow();
    await expect(
      dryRun(editor, { filename: "header.csv", bytes: file() }),
    ).rejects.toBeInstanceOf(UnprocessableError);
  });

  it("ignores columns it does not know, and a byte-order mark", async () => {
    const result = await dryRun(editor, {
      filename: "extra.csv",
      bytes: Buffer.from(
        "﻿name,notes,internal_owner\nMarginalia Press,check with legal,someone\n",
      ),
    });
    expect(result.summary.create).toBe(1);
    expect(result.rows[0]?.name).toBe("Marginalia Press");
  });
});

describe("spreadsheet formulas (SEC-07)", () => {
  it("stores the value raw and neutralises it only on export", async () => {
    const formula = '=HYPERLINK("https://evil.example","click")';
    const result = await dryRun(editor, {
      filename: "formula.csv",
      bytes: Buffer.from(`name,tagline\nFormula Co,"${formula}"\n`),
    });

    const [job] = await getDb()
      .select({ rows: importJobs.rows })
      .from(importJobs)
      .where(eq(importJobs.id, result.importJobId));
    // Raw in storage: it is data, whatever a spreadsheet would make of it.
    expect(JSON.stringify(job?.rows)).toContain("=HYPERLINK");

    const report = await exportReport(editor, result.importJobId);
    expect(report.filename).toBe("formula-report.csv");
    // Prefixed on the way out, so opening the report cannot execute it.
    expect(report.csv).not.toMatch(/,"=HYPERLINK/);
  });

  it("neutralises a formula that reaches the report through a row's name", async () => {
    const result = await dryRun(editor, {
      filename: "names.csv",
      bytes: Buffer.from("name\n\"=cmd|' /c calc'!A0\"\n"),
    });
    const report = await exportReport(editor, result.importJobId);
    expect(report.csv).toContain("\"'=cmd");
  });
});

describe("commit applies the stored plan, or nothing (SEC-07)", () => {
  it("creates drafts with their industries, founders and investors", async () => {
    const before = await countStartups();
    const plan = await dryRun(editor, {
      filename: "commit.csv",
      bytes: file(
        "Harbour Ledger,,Treasury tools for ports.,https://harbour-ledger.example/,seed,remote,2022,london-gb,fintech,Mira Okafor;Ada Weaver,Northwind Ventures;Parkway VC",
      ),
    });
    expect(plan.summary.create).toBe(1);

    const result = await commit(editor, { importJobId: plan.importJobId });
    expect(result).toMatchObject({ created: 1, updated: 0, skipped: 0 });
    expect(await countStartups()).toBe(before + 1);
    expect(await jobStatus(plan.importJobId)).toBe("committed");

    const [created] = await getDb()
      .select({
        id: startups.id,
        status: startups.status,
        tagline: startups.tagline,
        locationId: startups.locationId,
      })
      .from(startups)
      .where(eq(startups.slug, "harbour-ledger"));
    // Imported records are drafts: an editor still decides what goes live.
    expect(created?.status).toBe("draft");
    expect(created?.locationId).not.toBeNull();

    const linkedIndustries = await getDb()
      .select({ id: startupIndustries.industryId })
      .from(startupIndustries)
      .where(eq(startupIndustries.startupId, created?.id ?? ""));
    expect(linkedIndustries).toHaveLength(1);

    // A name we already hold is reused; a new one becomes a draft of its own.
    const [newFounder] = await getDb()
      .select({ status: founders.status })
      .from(founders)
      .where(eq(founders.fullName, "Ada Weaver"));
    expect(newFounder?.status).toBe("draft");
    const [newInvestor] = await getDb()
      .select({ status: investors.status, type: investors.investorType })
      .from(investors)
      .where(eq(investors.name, "Parkway VC"));
    expect(newInvestor).toMatchObject({ status: "draft", type: "vc" });

    const audits = await getDb()
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.entityId, created?.id ?? ""));
    expect(audits.map((row) => row.action)).toContain("create");

    await expect(
      commit(editor, { importJobId: plan.importJobId }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("updates a record named by an explicit slug", async () => {
    const plan = await dryRun(editor, {
      filename: "update.csv",
      bytes: file(
        "Pebble Notes,pebble-notes,Notes that link themselves — revised.,,,,,,,,",
      ),
    });
    expect(plan.summary.update).toBe(1);

    expect(
      await commit(editor, { importJobId: plan.importJobId }),
    ).toMatchObject({ created: 0, updated: 1 });
    const [updated] = await getDb()
      .select({ tagline: startups.tagline })
      .from(startups)
      .where(eq(startups.slug, "pebble-notes"));
    expect(updated?.tagline).toBe("Notes that link themselves — revised.");
  });

  it("refuses, writing nothing, when the data changed since the dry run", async () => {
    const plan = await dryRun(editor, {
      filename: "stale.csv",
      bytes: file("Contested Name,,First past the post.,,,,,,,,"),
    });
    const before = await countStartups();

    // Someone else creates the same company between review and commit.
    await getDb()
      .insert(startups)
      .values({ slug: "contested-name", name: "Contested Name" });

    const refusal = commit(editor, { importJobId: plan.importJobId });
    await expect(refusal).rejects.toBeInstanceOf(ConflictError);
    await expect(refusal).rejects.toMatchObject({ code: "IMPORT_STALE" });
    // The interloper is the only new row, and the job stays open for a fresh dry run.
    expect(await countStartups()).toBe(before + 1);
    expect(await jobStatus(plan.importJobId)).toBe("dry_run");
  });

  it("refuses when the record it would update was edited since the dry run", async () => {
    const plan = await dryRun(editor, {
      filename: "edited.csv",
      bytes: file("Tidal Ledger,tidal-ledger,Edited underneath us.,,,,,,,,"),
    });
    await getDb()
      .update(startups)
      .set({ tagline: "Changed by someone else." })
      .where(eq(startups.slug, "tidal-ledger"));

    await expect(
      commit(editor, { importJobId: plan.importJobId }),
    ).rejects.toMatchObject({ code: "IMPORT_STALE" });
  });

  it("expires a dry run after 24 hours", async () => {
    const plan = await dryRun(editor, {
      filename: "old.csv",
      bytes: file("Yesterday Systems,,Too late to commit.,,,,,,,,"),
    });
    await getDb()
      .update(importJobs)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(importJobs.id, plan.importJobId));

    await expect(
      commit(editor, { importJobId: plan.importJobId }),
    ).rejects.toMatchObject({ code: "IMPORT_EXPIRED" });
    expect(await jobStatus(plan.importJobId)).toBe("expired");
  });

  it("writes nothing when one row fails partway through", async () => {
    const [spare] = await getDb()
      .insert(industries)
      .values({ slug: "temporary-sector", name: "Temporary Sector" })
      .returning({ id: industries.id });

    const plan = await dryRun(editor, {
      filename: "partial.csv",
      bytes: file(
        "Rollback One,,First row.,,,,,,temporary-sector,,",
        "Rollback Two,,Second row.,,,,,,temporary-sector,,",
      ),
    });
    expect(plan.summary.create).toBe(2);
    const before = await countStartups();

    // The industry disappears between review and commit, so applying a row fails.
    await getDb()
      .delete(industries)
      .where(eq(industries.id, spare?.id ?? ""));

    await expect(
      commit(editor, { importJobId: plan.importJobId }),
    ).rejects.toBeInstanceOf(UnprocessableError);
    expect(await countStartups()).toBe(before);
    expect(await jobStatus(plan.importJobId)).toBe("dry_run");
  });

  it("answers an unknown job with a 404", async () => {
    await expect(
      commit(editor, {
        importJobId: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      exportReport(editor, "00000000-0000-4000-8000-000000000000"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
