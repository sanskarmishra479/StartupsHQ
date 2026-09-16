import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  ilike,
  inArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { z } from "zod";
import type { ReadContext } from "../auth/context";
import { assertEditor } from "../auth/guards";
import { type Database, getDb } from "../db/client";
import {
  batches,
  founders,
  fundingRounds,
  industries,
  investments,
  investors,
  startupBatches,
  startupFounders,
  startupIndustries,
  startups,
} from "../db/schema";
import type { Cursor } from "../lib/cursor";
import { NotFoundError } from "../lib/errors";
import { beginPage, cursorKey, finishPage } from "../lib/keyset";
import type { Page } from "../lib/pagination";
import { updateBatchSchema } from "../validation/batches";
import { updateFounderSchema } from "../validation/founders";
import { updateInvestorSchema } from "../validation/investors";
import { updateRoundSchema } from "../validation/rounds";
import { isUuid } from "../validation/shared";
import { updateStartupSchema } from "../validation/startups";

// Admin reads (docs/API.md §8.1): what the admin panel lists and edits, drafts and archived
// records included. These are the only reads that do not apply visibilityFilter, so they open
// with assertEditor and are never cached (SEC-03.3, ADR-013). `values` holds exactly the fields
// PATCH accepts, so a form can send them straight back.

export const ADMIN_ENTITIES = [
  "startup",
  "founder",
  "investor",
  "batch",
  "round",
] as const;

export type AdminEntity = (typeof ADMIN_ENTITIES)[number];

type Status = "draft" | "published" | "archived";

export type AdminListInput = Readonly<{
  status?: Status;
  q?: string;
  cursor?: string;
  limit?: number;
}>;

export type AdminListItem = Readonly<{
  id: string;
  slug: string | null;
  name: string;
  subtitle: string | null;
  status: Status;
  updatedAt: string;
  firstPublishedAt: string | null;
}>;

export type AdminRecord = Readonly<{
  entity: AdminEntity;
  id: string;
  slug: string | null;
  status: Status;
  firstPublishedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Exactly the fields `PATCH /{entity}/{id}` accepts. */
  values: Record<string, unknown>;
  /** Server-computed and read-only. */
  derived: Record<string, unknown>;
  /** Startups only: the join rows edited through §8.3. */
  links?: Record<string, readonly unknown[]>;
}>;

/** Its own sort, so a cursor minted here can never be replayed against a public listing. */
const SORT = "admin-updated";
const MAX_QUERY_LENGTH = 100;

type Spec = Readonly<{
  table: PgTable;
  schema: z.ZodObject;
  hasSlug: boolean;
  nameKey: string;
  secondNameKey?: string;
  nameSeparator?: string;
  subtitleKey?: string;
  searchKeys: readonly string[];
  derivedKeys: readonly string[];
}>;

const SPECS: Record<AdminEntity, Spec> = {
  startup: {
    table: startups,
    schema: updateStartupSchema,
    hasSlug: true,
    nameKey: "name",
    subtitleKey: "tagline",
    searchKeys: ["name"],
    derivedKeys: ["totalRaisedUsd", "totalDebtUsd", "latestRoundId"],
  },
  founder: {
    table: founders,
    schema: updateFounderSchema,
    hasSlug: true,
    nameKey: "fullName",
    subtitleKey: "headline",
    searchKeys: ["fullName"],
    derivedKeys: [],
  },
  investor: {
    table: investors,
    schema: updateInvestorSchema,
    hasSlug: true,
    nameKey: "name",
    subtitleKey: "description",
    searchKeys: ["name"],
    derivedKeys: [],
  },
  batch: {
    table: batches,
    schema: updateBatchSchema,
    hasSlug: true,
    nameKey: "programName",
    secondNameKey: "label",
    nameSeparator: " ",
    searchKeys: ["programName", "label"],
    derivedKeys: [],
  },
  round: {
    table: fundingRounds,
    schema: updateRoundSchema,
    hasSlug: false,
    nameKey: "roundType",
    secondNameKey: "announcedOn",
    nameSeparator: " · ",
    searchKeys: ["roundType"],
    derivedKeys: [
      "startupId",
      "amountUsd",
      "fxRate",
      "fxRateDate",
      "fxSource",
      "roundClass",
    ],
  },
};

function specFor(entity: string): { name: AdminEntity; spec: Spec } {
  if (!(ADMIN_ENTITIES as readonly string[]).includes(entity)) {
    throw new NotFoundError();
  }
  const name = entity as AdminEntity;
  return { name, spec: SPECS[name] };
}

type Columns = Record<string, PgColumn>;

const columnsOf = (table: PgTable): Columns =>
  getTableColumns(table) as unknown as Columns;

function col(columns: Columns, key: string): PgColumn {
  const column = columns[key];
  // The specs name columns of these tables, so a miss is a programming error, not bad input.
  if (!column) throw new Error(`Unknown column ${key}`);
  return column;
}

const iso = (value: unknown): unknown =>
  value instanceof Date ? value.toISOString() : (value ?? null);

const isoOrNull = (value: unknown): string | null =>
  value instanceof Date ? value.toISOString() : null;

/** Escapes a search term so `%` and `_` cannot widen the pattern. */
const escapeLike = (value: string) =>
  value.replace(/[\\%_]/g, (character) => `\\${character}`);

function after(columns: Columns, cursor: Cursor): SQL {
  const updatedAt = cursorKey(cursor, "string");
  return sql`(${col(columns, "updatedAt")} < ${updatedAt}::timestamptz or (${col(columns, "updatedAt")} = ${updatedAt}::timestamptz and ${col(columns, "id")} > ${cursor.id}::uuid))`;
}

const NULL_TEXT = sql<string | null>`null`;

/** A round's list row names its startup, which lives in another table. */
async function startupNames(
  db: Database,
  ids: readonly (string | null)[],
): Promise<ReadonlyMap<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  if (wanted.length === 0) return new Map();
  const rows = await db
    .select({ id: startups.id, name: startups.name })
    .from(startups)
    .where(inArray(startups.id, wanted));
  return new Map(rows.map((row) => [row.id, row.name]));
}

export async function listRecords(
  ctx: ReadContext,
  entity: string,
  input: AdminListInput = {},
): Promise<Page<AdminListItem>> {
  assertEditor(ctx);
  const { name: entityName, spec } = specFor(entity);
  const columns = columnsOf(spec.table);
  const request = beginPage(ctx, SORT, input.cursor, input.limit);
  const db = getDb();

  const conditions: (SQL | undefined)[] = [];
  if (input.status) {
    conditions.push(eq(col(columns, "status"), input.status));
  }
  const term = input.q?.trim();
  if (term) {
    const needle = `%${escapeLike(term.slice(0, MAX_QUERY_LENGTH))}%`;
    conditions.push(
      or(...spec.searchKeys.map((key) => ilike(col(columns, key), needle))),
    );
  }
  if (request.cursor) conditions.push(after(columns, request.cursor));

  const rows = await db
    .select({
      id: col(columns, "id"),
      status: col(columns, "status"),
      updatedAt: col(columns, "updatedAt"),
      firstPublishedAt: col(columns, "firstPublishedAt"),
      slug: spec.hasSlug ? col(columns, "slug") : NULL_TEXT,
      name: col(columns, spec.nameKey),
      second: spec.secondNameKey ? col(columns, spec.secondNameKey) : NULL_TEXT,
      subtitle: spec.subtitleKey ? col(columns, spec.subtitleKey) : NULL_TEXT,
      startupId: entityName === "round" ? col(columns, "startupId") : NULL_TEXT,
    })
    .from(spec.table)
    .where(and(...conditions))
    .orderBy(desc(col(columns, "updatedAt")), asc(col(columns, "id")))
    .limit(request.limit + 1);

  const names = await startupNames(
    db,
    rows.map((row) => (row.startupId === null ? null : String(row.startupId))),
  );

  return finishPage(
    request,
    rows,
    (row): AdminListItem => {
      const parts = [row.name, row.second].filter(
        (part): part is string => part !== null && part !== undefined,
      );
      return {
        id: String(row.id),
        slug: row.slug === null ? null : String(row.slug),
        name: parts.join(spec.nameSeparator ?? " "),
        subtitle:
          entityName === "round"
            ? (names.get(String(row.startupId)) ?? null)
            : row.subtitle === null || row.subtitle === undefined
              ? null
              : String(row.subtitle),
        status: row.status as Status,
        updatedAt: (row.updatedAt as Date).toISOString(),
        firstPublishedAt: isoOrNull(row.firstPublishedAt),
      };
    },
    (row) => ({
      key: [(row.updatedAt as Date).toISOString()],
      id: String(row.id),
    }),
  );
}

/** The join rows a startup's form edits, each with the id §8.3 addresses it by. */
async function startupLinks(
  db: Database,
  startupId: string,
): Promise<Record<string, readonly unknown[]>> {
  const [industryRows, founderRows, investorRows, batchRows, roundRows] =
    await Promise.all([
      db
        .select({
          id: industries.id,
          slug: industries.slug,
          name: industries.name,
          isPrimary: startupIndustries.isPrimary,
        })
        .from(startupIndustries)
        .innerJoin(industries, eq(industries.id, startupIndustries.industryId))
        .where(eq(startupIndustries.startupId, startupId))
        .orderBy(desc(startupIndustries.isPrimary), asc(industries.name)),
      db
        .select({
          linkId: startupFounders.id,
          founderId: founders.id,
          slug: founders.slug,
          fullName: founders.fullName,
          status: founders.status,
          role: startupFounders.role,
          isCurrent: startupFounders.isCurrent,
          joinedYear: startupFounders.joinedYear,
          leftYear: startupFounders.leftYear,
          sortOrder: startupFounders.sortOrder,
          sourceUrl: startupFounders.sourceUrl,
        })
        .from(startupFounders)
        .innerJoin(founders, eq(founders.id, startupFounders.founderId))
        .where(eq(startupFounders.startupId, startupId))
        .orderBy(asc(startupFounders.sortOrder), asc(founders.fullName)),
      db
        .select({
          linkId: investments.id,
          investorId: investors.id,
          slug: investors.slug,
          name: investors.name,
          status: investors.status,
          roundId: investments.roundId,
          isLead: investments.isLead,
          amountUsd: investments.amountUsd,
        })
        .from(investments)
        .innerJoin(investors, eq(investors.id, investments.investorId))
        .where(eq(investments.startupId, startupId))
        .orderBy(desc(investments.isLead), asc(investors.name)),
      db
        .select({
          batchId: batches.id,
          slug: batches.slug,
          programName: batches.programName,
          label: batches.label,
          year: batches.year,
          status: batches.status,
        })
        .from(startupBatches)
        .innerJoin(batches, eq(batches.id, startupBatches.batchId))
        .where(eq(startupBatches.startupId, startupId))
        .orderBy(desc(batches.year), asc(batches.label)),
      db
        .select({
          id: fundingRounds.id,
          roundType: fundingRounds.roundType,
          announcedOn: fundingRounds.announcedOn,
          status: fundingRounds.status,
          isUndisclosed: fundingRounds.isUndisclosed,
          amountUsd: fundingRounds.amountUsd,
          currency: fundingRounds.currency,
        })
        .from(fundingRounds)
        .where(eq(fundingRounds.startupId, startupId))
        .orderBy(desc(fundingRounds.announcedOn), asc(fundingRounds.id)),
    ]);

  return {
    industries: industryRows,
    founders: founderRows,
    investors: investorRows,
    batches: batchRows,
    rounds: roundRows,
  };
}

export async function getRecord(
  ctx: ReadContext,
  entity: string,
  id: string,
): Promise<AdminRecord> {
  assertEditor(ctx);
  const { name: entityName, spec } = specFor(entity);
  if (!isUuid(id)) throw new NotFoundError();
  const columns = columnsOf(spec.table);
  const db = getDb();

  // Only schema keys that are columns: `manualFx`, for instance, is an input, not a field.
  const valueKeys = Object.keys(spec.schema.shape).filter(
    (key) => columns[key] !== undefined,
  );
  const selection: Record<string, PgColumn | SQL> = {
    __id: col(columns, "id"),
    __status: col(columns, "status"),
    __firstPublishedAt: col(columns, "firstPublishedAt"),
    __archivedAt: col(columns, "archivedAt"),
    __createdAt: col(columns, "createdAt"),
    __updatedAt: col(columns, "updatedAt"),
    __slug: spec.hasSlug ? col(columns, "slug") : NULL_TEXT,
  };
  for (const key of [...valueKeys, ...spec.derivedKeys]) {
    selection[key] = col(columns, key);
  }

  const [row] = await db
    .select(selection)
    .from(spec.table)
    .where(eq(col(columns, "id"), id))
    .limit(1);
  if (!row) throw new NotFoundError();

  const pick = (keys: readonly string[]) =>
    Object.fromEntries(keys.map((key) => [key, iso(row[key])]));

  return {
    entity: entityName,
    id: String(row.__id),
    slug: row.__slug === null ? null : String(row.__slug),
    status: row.__status as Status,
    firstPublishedAt: isoOrNull(row.__firstPublishedAt),
    archivedAt: isoOrNull(row.__archivedAt),
    createdAt: (row.__createdAt as Date).toISOString(),
    updatedAt: (row.__updatedAt as Date).toISOString(),
    values: pick(valueKeys),
    derived: pick(spec.derivedKeys),
    ...(entityName === "startup" ? { links: await startupLinks(db, id) } : {}),
  };
}
