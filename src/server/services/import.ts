import "server-only";

import { createHash } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { slugify } from "../../lib/slug";
import type { ReadContext } from "../auth/context";
import { type AdminContext, assertEditor } from "../auth/guards";
import { auditDiff, writeAudit } from "../db/audit";
import { type Database, getDb, type Transaction } from "../db/client";
import { runMutation } from "../db/mutation";
import {
  founders,
  importJobs,
  industries,
  investors,
  locations,
  startups,
} from "../db/schema";
import {
  insertFounderLink,
  insertInvestorLink,
  replaceIndustries,
} from "../db/writes/relations";
import { claimSlug } from "../db/writes/slugs";
import { startupTags } from "../db/writes/tags";
import { parseCsv, toCsv } from "../lib/csv";
import {
  ConflictError,
  NotFoundError,
  UnprocessableError,
  ValidationError,
} from "../lib/errors";
import { FOUNDER_PERSONAL_FIELDS } from "../validation/founders";
import {
  type CommitImportInput,
  commitImportSchema,
  type ImportRow,
  importRowSchema,
} from "../validation/import";
import { parseInput } from "../validation/shared";

// CSV bulk import (docs/API.md §8.7, FR-402, SEC-07).
//
// The dry-run is mandatory and is the only thing that reads the file: it normalises every row,
// decides what each would do, and stores that plan with the file's SHA-256. Commit applies the
// **stored plan**, re-checking against current data inside the transaction, so an edit made
// between review and commit aborts the whole thing rather than half-applying it.

export const MAX_IMPORT_ROWS = 1000;
/** Above this, two names are close enough that a human should decide (FR-402). */
export const DUPLICATE_SIMILARITY = 0.85;
/** Unknown investors arrive with no type; editors correct this on the draft. */
const DEFAULT_INVESTOR_TYPE = "vc" as const;

export type RowAction = "create" | "update" | "skip" | "error";

export type RowIssue = Readonly<{ path: string; message: string }>;

/** What the dry-run decided for one row. Stored on the job and replayed at commit. */
type PlannedRow = {
  row: number;
  action: RowAction;
  name: string;
  slug: string | null;
  reason?: string;
  errors?: RowIssue[];
  values?: ImportRow;
  targetId?: string;
  /** The target's `updated_at` when planned; a change means someone edited it since. */
  targetUpdatedAt?: string;
};

export type ReportedRow = Readonly<{
  row: number;
  action: RowAction;
  name: string;
  slug: string | null;
  reason?: string;
  errors?: RowIssue[];
}>;

export type DryRunResult = Readonly<{
  importJobId: string;
  expiresAt: string;
  rowCount: number;
  summary: Readonly<{
    create: number;
    update: number;
    skip: number;
    error: number;
  }>;
  rows: readonly ReportedRow[];
  newFounders: readonly string[];
  newInvestors: readonly string[];
}>;

export type CommitResult = Readonly<{
  importJobId: string;
  created: number;
  updated: number;
  skipped: number;
}>;

const report = (row: PlannedRow): ReportedRow => ({
  row: row.row,
  action: row.action,
  name: row.name,
  slug: row.slug,
  ...(row.reason ? { reason: row.reason } : {}),
  ...(row.errors ? { errors: row.errors } : {}),
});

const lower = (value: string) => value.trim().toLowerCase();

// ── Lookups, all batched: one query per kind, however many rows ──────────────────────────────

type Lookups = Readonly<{
  locations: ReadonlyMap<string, string>;
  industries: ReadonlyMap<string, string>;
  founders: ReadonlyMap<string, string>;
  investors: ReadonlyMap<string, string>;
  startupsBySlug: ReadonlyMap<string, { id: string; updatedAt: Date }>;
  nearDuplicates: ReadonlyMap<string, { name: string; score: number }>;
}>;

async function loadLookups(
  db: Database,
  rows: readonly ImportRow[],
  candidateSlugs: readonly string[],
): Promise<Lookups> {
  const unique = (values: readonly string[]) => [...new Set(values)];
  const locationSlugs = unique(
    rows
      .map((row) => row.location)
      .filter((slug): slug is string => Boolean(slug)),
  );
  const industrySlugs = unique(
    rows.flatMap((row) => row.industries.map(lower)),
  );
  const founderNames = unique(rows.flatMap((row) => row.founders.map(lower)));
  const investorNames = unique(rows.flatMap((row) => row.investors.map(lower)));
  const slugs = unique(candidateSlugs);
  const names = unique(rows.map((row) => row.name));

  const [
    locationRows,
    industryRows,
    founderRows,
    investorRows,
    startupRows,
    duplicateRows,
  ] = await Promise.all([
    locationSlugs.length === 0
      ? []
      : db
          .select({ id: locations.id, slug: locations.slug })
          .from(locations)
          .where(inArray(locations.slug, locationSlugs)),
    industrySlugs.length === 0
      ? []
      : db
          .select({ id: industries.id, slug: industries.slug })
          .from(industries)
          .where(inArray(sql`lower(${industries.slug})`, industrySlugs)),
    founderNames.length === 0
      ? []
      : db
          .select({ id: founders.id, name: founders.fullName })
          .from(founders)
          .where(inArray(sql`lower(${founders.fullName})`, founderNames)),
    investorNames.length === 0
      ? []
      : db
          .select({ id: investors.id, name: investors.name })
          .from(investors)
          .where(inArray(sql`lower(${investors.name})`, investorNames)),
    slugs.length === 0
      ? []
      : db
          .select({
            id: startups.id,
            slug: startups.slug,
            updatedAt: startups.updatedAt,
          })
          .from(startups)
          .where(inArray(startups.slug, slugs)),
    names.length === 0 ? { rows: [] } : nearDuplicateQuery(db, names),
  ]);

  const nearest = new Map<string, { name: string; score: number }>();
  for (const row of "rows" in duplicateRows ? duplicateRows.rows : []) {
    const key = lower(row.input);
    const current = nearest.get(key);
    if (!current || row.score > current.score) {
      nearest.set(key, { name: row.match, score: row.score });
    }
  }

  return {
    locations: new Map(locationRows.map((row) => [row.slug, row.id])),
    industries: new Map(industryRows.map((row) => [lower(row.slug), row.id])),
    founders: new Map(founderRows.map((row) => [lower(row.name), row.id])),
    investors: new Map(investorRows.map((row) => [lower(row.name), row.id])),
    startupsBySlug: new Map(
      startupRows.map((row) => [
        row.slug,
        { id: row.id, updatedAt: row.updatedAt },
      ]),
    ),
    nearDuplicates: nearest,
  };
}

/**
 * One trigram query for every name in the file, not one per row. The names are a parameterised
 * VALUES list: an array parameter would be flattened into separate placeholders by the query
 * builder, and interpolating the names would be string-built SQL.
 */
function nearDuplicateQuery(db: Database, names: readonly string[]) {
  const folded = sql`public.immutable_unaccent(lower(${startups.name}))`;
  const candidates = sql.join(
    names.map((name) => sql`(${name}::text)`),
    sql`, `,
  );
  return db.execute<{ input: string; match: string; score: number }>(sql`
    select candidate.name as input,
           ${startups.name} as match,
           similarity(${folded}, public.immutable_unaccent(lower(candidate.name))) as score
      from (values ${candidates}) as candidate(name)
      join ${startups}
        on ${folded} % public.immutable_unaccent(lower(candidate.name))
     where similarity(${folded}, public.immutable_unaccent(lower(candidate.name))) > ${DUPLICATE_SIMILARITY}`);
}

// ── Dry run ──────────────────────────────────────────────────────────────────────────────────

export type DryRunInput = Readonly<{ filename: string; bytes: Uint8Array }>;

function decode(bytes: Uint8Array): string {
  const text = new TextDecoder("utf-8").decode(bytes);
  // Spreadsheets love a byte-order mark; it would otherwise corrupt the first header.
  return text.startsWith("﻿") ? text.slice(1) : text;
}

export async function dryRun(
  ctx: ReadContext,
  input: DryRunInput,
): Promise<DryRunResult> {
  assertEditor(ctx);
  const filename = input.filename.trim().slice(0, 255) || "import.csv";
  if (input.bytes.byteLength === 0) {
    throw new ValidationError([
      { path: "file", message: "The file is empty." },
    ]);
  }

  const { rows: rawRows, problems } = parseCsv(decode(input.bytes));
  if (rawRows.length === 0) {
    throw new UnprocessableError(
      problems[0] ?? "That file has no rows under its header.",
    );
  }
  if (rawRows.length > MAX_IMPORT_ROWS) {
    throw new UnprocessableError(
      `That file has ${rawRows.length} rows; ${MAX_IMPORT_ROWS} is the most an import may carry.`,
    );
  }

  // Validate every row first, so lookups run once over everything that parsed.
  const parsed = rawRows.map((raw) => importRowSchema.safeParse(raw));
  const valid = parsed.flatMap((result) =>
    result.success ? [result.data] : [],
  );
  const candidateSlugs = valid.map(
    (row) => row.slug ?? (slugify(row.name) || ""),
  );
  const db = getDb();
  const lookups = await loadLookups(db, valid, candidateSlugs);

  const planned: PlannedRow[] = [];
  const seenSlugs = new Set<string>();
  const newFounders = new Set<string>();
  const newInvestors = new Set<string>();

  let validIndex = 0;
  for (const [index, result] of parsed.entries()) {
    const rowNumber = index + 1;
    if (!result.success) {
      const raw = rawRows[index] ?? {};
      planned.push({
        row: rowNumber,
        action: "error",
        name: raw.name ?? "",
        slug: null,
        errors: result.error.issues.map((issue) => ({
          path: issue.path.map(String).join(".") || "(row)",
          message: issue.message,
        })),
      });
      continue;
    }

    const values = result.data;
    const slug = candidateSlugs[validIndex] ?? "";
    validIndex += 1;

    const issues = referenceIssues(values, lookups);
    if (issues.length > 0) {
      planned.push({
        row: rowNumber,
        action: "error",
        name: values.name,
        slug,
        errors: issues,
      });
      continue;
    }
    if (!slug) {
      planned.push({
        row: rowNumber,
        action: "error",
        name: values.name,
        slug: null,
        errors: [
          {
            path: "slug",
            message:
              "A slug could not be made from this name; add a slug column for it.",
          },
        ],
      });
      continue;
    }

    if (seenSlugs.has(slug)) {
      planned.push({
        row: rowNumber,
        action: "skip",
        name: values.name,
        slug,
        reason: `Duplicate of an earlier row in this file (slug '${slug}')`,
      });
      continue;
    }
    seenSlugs.add(slug);

    const existing = lookups.startupsBySlug.get(slug);
    if (existing && values.slug) {
      // An explicit slug naming a record we hold is the only way to change one.
      planned.push({
        row: rowNumber,
        action: "update",
        name: values.name,
        slug,
        values,
        targetId: existing.id,
        targetUpdatedAt: existing.updatedAt.toISOString(),
      });
    } else if (existing) {
      planned.push({
        row: rowNumber,
        action: "skip",
        name: values.name,
        slug,
        reason: `Duplicate: slug '${slug}' exists`,
      });
    } else {
      const near = lookups.nearDuplicates.get(lower(values.name));
      if (near) {
        planned.push({
          row: rowNumber,
          action: "skip",
          name: values.name,
          slug,
          reason: `Possible duplicate of '${near.name}' (similarity ${near.score.toFixed(2)})`,
        });
      } else {
        planned.push({
          row: rowNumber,
          action: "create",
          name: values.name,
          slug,
          values,
        });
      }
    }

    const last = planned.at(-1);
    if (last && (last.action === "create" || last.action === "update")) {
      for (const person of values.founders) {
        if (!lookups.founders.has(lower(person))) newFounders.add(person);
      }
      for (const firm of values.investors) {
        if (!lookups.investors.has(lower(firm))) newInvestors.add(firm);
      }
    }
  }

  const summary = {
    create: planned.filter((row) => row.action === "create").length,
    update: planned.filter((row) => row.action === "update").length,
    skip: planned.filter((row) => row.action === "skip").length,
    error: planned.filter((row) => row.action === "error").length,
  };

  const [job] = await db
    .insert(importJobs)
    .values({
      filename,
      fileSha256: createHash("sha256").update(input.bytes).digest("hex"),
      status: "dry_run",
      rows: planned,
      rowCount: planned.length,
      createCount: summary.create,
      updateCount: summary.update,
      skipCount: summary.skip,
      errorCount: summary.error,
      errors: problems,
      actorId: ctx.actor.id,
    })
    .returning({ id: importJobs.id, expiresAt: importJobs.expiresAt });
  if (!job) throw new Error("The import job was not stored.");

  return {
    importJobId: job.id,
    expiresAt: job.expiresAt.toISOString(),
    rowCount: planned.length,
    summary,
    rows: planned.map(report),
    newFounders: [...newFounders],
    newInvestors: [...newInvestors],
  };
}

/** Columns that name another record: unknown values are the row's problem, not the import's. */
function referenceIssues(values: ImportRow, lookups: Lookups): RowIssue[] {
  const issues: RowIssue[] = [];
  if (values.location && !lookups.locations.has(values.location)) {
    issues.push({
      path: "location",
      message: `No location has the slug '${values.location}'.`,
    });
  }
  for (const industry of values.industries) {
    if (!lookups.industries.has(lower(industry))) {
      issues.push({
        path: "industries",
        message: `No industry has the slug '${industry}'.`,
      });
    }
  }
  return issues;
}

// ── Commit ───────────────────────────────────────────────────────────────────────────────────

type JobRow = Readonly<{
  id: string;
  status: string;
  rows: PlannedRow[];
  expiresAt: Date;
}>;

async function applyCreate(
  tx: Transaction,
  ctx: AdminContext | (ReadContext & { actor: { id: string } }),
  row: PlannedRow,
  lookups: Lookups,
): Promise<string> {
  const values = row.values as ImportRow;
  const actorId = ctx.actor.id;
  const slug = await claimSlug(tx, "startup", {
    name: values.name,
    slug: values.slug,
  });

  const [created] = await tx
    .insert(startups)
    .values({
      slug,
      name: values.name,
      tagline: values.tagline ?? null,
      description: values.description ?? null,
      websiteUrl: values.websiteurl ?? null,
      careersUrl: values.careersurl ?? null,
      stage: values.stage ?? null,
      workType: values.worktype ?? null,
      headcountBand: values.headcountband ?? null,
      foundedYear: values.foundedyear ?? null,
      locationId: values.location
        ? (lookups.locations.get(values.location) ?? null)
        : null,
      createdBy: actorId,
      updatedBy: actorId,
    })
    .returning({ id: startups.id });
  if (!created) throw new Error("A row could not be created.");

  await linkRow(tx, ctx, created.id, values, lookups);
  await writeAudit(tx, ctx as AdminContext, {
    entityType: "startup",
    entityId: created.id,
    action: "create",
    diff: auditDiff(null, { slug, name: values.name, source: "csv-import" }),
  });
  return created.id;
}

async function applyUpdate(
  tx: Transaction,
  ctx: AdminContext,
  row: PlannedRow,
  lookups: Lookups,
): Promise<void> {
  const values = row.values as ImportRow;
  const id = row.targetId as string;
  const changes = {
    name: values.name,
    ...(values.tagline === undefined ? {} : { tagline: values.tagline }),
    ...(values.description === undefined
      ? {}
      : { description: values.description }),
    ...(values.websiteurl === undefined
      ? {}
      : { websiteUrl: values.websiteurl }),
    ...(values.careersurl === undefined
      ? {}
      : { careersUrl: values.careersurl }),
    ...(values.stage === undefined ? {} : { stage: values.stage }),
    ...(values.worktype === undefined ? {} : { workType: values.worktype }),
    ...(values.headcountband === undefined
      ? {}
      : { headcountBand: values.headcountband }),
    ...(values.foundedyear === undefined
      ? {}
      : { foundedYear: values.foundedyear }),
    ...(values.location === undefined
      ? {}
      : { locationId: lookups.locations.get(values.location) ?? null }),
    updatedBy: ctx.actor.id,
  };

  await tx.update(startups).set(changes).where(eq(startups.id, id));
  if (values.industries.length > 0) {
    await replaceIndustries(
      tx,
      id,
      values.industries.map((slug, index) => ({
        id: lookups.industries.get(lower(slug)) as string,
        isPrimary: index === 0,
      })),
    );
  }
  await writeAudit(tx, ctx, {
    entityType: "startup",
    entityId: id,
    action: "update",
    diff: auditDiff(null, { ...changes, source: "csv-import" }),
  });
}

/** Industries, and the founders and investors named by the row — creating drafts for new names. */
async function linkRow(
  tx: Transaction,
  ctx: AdminContext | (ReadContext & { actor: { id: string } }),
  startupId: string,
  values: ImportRow,
  lookups: Lookups,
): Promise<void> {
  const actorId = ctx.actor.id;

  if (values.industries.length > 0) {
    await replaceIndustries(
      tx,
      startupId,
      values.industries.map((slug, index) => ({
        id: lookups.industries.get(lower(slug)) as string,
        isPrimary: index === 0,
      })),
    );
  }

  for (const person of values.founders) {
    let founderId = lookups.founders.get(lower(person));
    if (!founderId) {
      const slug = await claimSlug(tx, "founder", { name: person });
      const [created] = await tx
        .insert(founders)
        .values({
          slug,
          fullName: person,
          createdBy: actorId,
          updatedBy: actorId,
        })
        .returning({ id: founders.id });
      if (!created) throw new Error("A founder could not be created.");
      founderId = created.id;
      (lookups.founders as Map<string, string>).set(lower(person), founderId);
      await writeAudit(tx, ctx as AdminContext, {
        entityType: "founder",
        entityId: founderId,
        action: "create",
        // A founder's name is personal data: recorded as changed, never by value (DM-12).
        diff: auditDiff(
          null,
          { fullName: person, slug, source: "csv-import" },
          FOUNDER_PERSONAL_FIELDS,
        ),
      });
    }
    await insertFounderLink(tx, startupId, { founderId, role: "founder" });
  }

  for (const firm of values.investors) {
    let investorId = lookups.investors.get(lower(firm));
    if (!investorId) {
      const slug = await claimSlug(tx, "investor", { name: firm });
      const [created] = await tx
        .insert(investors)
        .values({
          slug,
          name: firm,
          investorType: DEFAULT_INVESTOR_TYPE,
          createdBy: actorId,
          updatedBy: actorId,
        })
        .returning({ id: investors.id });
      if (!created) throw new Error("An investor could not be created.");
      investorId = created.id;
      (lookups.investors as Map<string, string>).set(lower(firm), investorId);
      await writeAudit(tx, ctx as AdminContext, {
        entityType: "investor",
        entityId: investorId,
        action: "create",
        diff: auditDiff(null, { name: firm, slug, source: "csv-import" }),
      });
    }
    await insertInvestorLink(tx, startupId, { investorId });
  }
}

export async function commit(
  ctx: ReadContext,
  input: CommitImportInput,
): Promise<CommitResult> {
  assertEditor(ctx);
  const { importJobId } = parseInput(commitImportSchema, input);
  const actor = ctx as AdminContext;
  const db = getDb();

  // Checked before the transaction, because marking a job expired must outlive the refusal that
  // follows it; the same checks run again inside, against a locked row.
  const [current] = await db
    .select({ status: importJobs.status, expiresAt: importJobs.expiresAt })
    .from(importJobs)
    .where(eq(importJobs.id, importJobId));
  if (!current) throw new NotFoundError();
  if (
    current.status === "dry_run" &&
    current.expiresAt.getTime() <= Date.now()
  ) {
    await db
      .update(importJobs)
      .set({ status: "expired" })
      .where(eq(importJobs.id, importJobId));
    throw new ConflictError(
      "This dry run is more than 24 hours old; run a new one.",
      "IMPORT_EXPIRED",
    );
  }

  return runMutation(async (tx, tags) => {
    const [job] = (await tx
      .select({
        id: importJobs.id,
        status: importJobs.status,
        rows: importJobs.rows,
        expiresAt: importJobs.expiresAt,
      })
      .from(importJobs)
      .where(eq(importJobs.id, importJobId))
      .for("update")) as JobRow[];
    if (!job) throw new NotFoundError();

    if (job.status === "committed") {
      throw new ConflictError("This import has already been committed.");
    }
    if (job.status !== "dry_run") {
      throw new ConflictError(
        "This import can no longer be committed; run a new dry run.",
        "IMPORT_EXPIRED",
      );
    }
    if (job.expiresAt.getTime() <= Date.now()) {
      throw new ConflictError(
        "This dry run is more than 24 hours old; run a new one.",
        "IMPORT_EXPIRED",
      );
    }

    const applying = job.rows.filter(
      (row) => row.action === "create" || row.action === "update",
    );

    // Re-checked here, inside the transaction, against data as it is now.
    const lookups = await loadLookups(
      tx as unknown as Database,
      applying.flatMap((row) => (row.values ? [row.values] : [])),
      applying.map((row) => row.slug ?? ""),
    );

    const stale: string[] = [];
    for (const row of applying) {
      const existing = row.slug
        ? lookups.startupsBySlug.get(row.slug)
        : undefined;
      if (row.action === "create" && existing) {
        stale.push(`row ${row.row}: '${row.slug}' now exists`);
      }
      if (row.action === "update") {
        if (!existing || existing.id !== row.targetId) {
          stale.push(
            `row ${row.row}: '${row.slug}' is no longer the same record`,
          );
        } else if (existing.updatedAt.toISOString() !== row.targetUpdatedAt) {
          stale.push(
            `row ${row.row}: '${row.slug}' was edited since the dry run`,
          );
        }
      }
    }
    if (stale.length > 0) {
      throw new ConflictError(
        `The data changed since the dry run, so nothing was imported — ${stale
          .slice(0, 10)
          .join("; ")}. Run a new dry run.`,
        "IMPORT_STALE",
      );
    }

    let created = 0;
    let updated = 0;
    const touched: string[] = [];
    for (const row of applying) {
      try {
        if (row.action === "create") {
          touched.push(await applyCreate(tx, actor, row, lookups));
          created += 1;
        } else {
          await applyUpdate(tx, actor, row, lookups);
          touched.push(row.targetId as string);
          updated += 1;
        }
      } catch (error) {
        // One bad row fails the import: the transaction rolls back, so nothing is half-applied.
        // The detail stays in the server log; the caller gets the row number (SEC-12).
        console.error(`[import] row ${row.row} could not be applied`, error);
        throw new UnprocessableError(
          `Row ${row.row} ('${row.name}') could not be imported, so nothing was. Fix it and run a new dry run.`,
        );
      }
    }

    await tx
      .update(importJobs)
      .set({ status: "committed", committedAt: new Date() })
      .where(eq(importJobs.id, job.id));

    // Imported records are drafts, so only the lists an editor sees need expiring; do it anyway
    // through the usual neighbours, since an update may touch a published record.
    for (const tag of await startupTags(tx, touched)) tags.add(tag);

    return {
      importJobId: job.id,
      created,
      updated,
      skipped: job.rows.length - applying.length,
    };
  });
}

// ── The report, as a CSV an editor can open ──────────────────────────────────────────────────

export async function exportReport(
  ctx: ReadContext,
  importJobId: string,
): Promise<{ filename: string; csv: string }> {
  assertEditor(ctx);
  const [job] = await getDb()
    .select({
      id: importJobs.id,
      filename: importJobs.filename,
      rows: importJobs.rows,
    })
    .from(importJobs)
    .where(eq(importJobs.id, importJobId));
  if (!job) throw new NotFoundError();

  const rows = (job.rows as PlannedRow[]).map((row) => [
    String(row.row),
    row.action,
    row.name,
    row.slug ?? "",
    row.reason ?? "",
    (row.errors ?? [])
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join(" | "),
  ]);

  return {
    filename: `${job.filename.replace(/\.csv$/i, "")}-report.csv`,
    csv: toCsv(["row", "action", "name", "slug", "reason", "errors"], rows),
  };
}
