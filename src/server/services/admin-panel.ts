import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import type { ReadContext } from "../auth/context";
import { assertEditor } from "../auth/guards";
import { getDb } from "../db/client";
import {
  auditLog,
  batches,
  founders,
  fundingRounds,
  importJobs,
  industries,
  investors,
  locations,
  mediaAssets,
  startups,
  taxonomyPages,
  users,
} from "../db/schema";
import { type Image, toImage } from "../dto/image";
import { isUuid } from "../validation/shared";
import {
  ADMIN_ENTITIES,
  type AdminEntity,
  type AdminListItem,
  listRecords,
} from "./admin-reads";

// The admin panel's own reads (FR-202, FR-204, FR-205, FR-206, FR-207): the dashboard, the pick
// lists a form needs, and the media and import browsers. Like admin-reads.ts these see every
// status, so each opens with assertEditor and none is cached (SEC-03.3, ADR-013). Audit rows are
// listed without their diffs, which can name personal fields (DM-12).

type StatusCounts = Readonly<{
  draft: number;
  published: number;
  archived: number;
}>;

export type AuditEntry = Readonly<{
  id: string;
  entityType: string;
  entityId: string | null;
  action: string;
  actorEmail: string | null;
  createdAt: string;
}>;

export type ImportJobSummary = Readonly<{
  id: string;
  filename: string;
  rowCount: number;
  summary: Readonly<{
    create: number;
    update: number;
    skip: number;
    error: number;
  }>;
  createdAt: string;
  expiresAt: string;
}>;

export type Dashboard = Readonly<{
  counts: Readonly<Record<AdminEntity, StatusCounts>>;
  drafts: readonly (AdminListItem & { entity: AdminEntity })[];
  recentAudit: readonly AuditEntry[];
  pendingImports: readonly ImportJobSummary[];
}>;

const TABLES = {
  startup: startups,
  founder: founders,
  investor: investors,
  batch: batches,
  round: fundingRounds,
} as const;

const DRAFT_QUEUE_SIZE = 10;
const RECENT_AUDIT_SIZE = 20;

async function statusCounts(entity: AdminEntity): Promise<StatusCounts> {
  const table = TABLES[entity];
  const rows = await getDb()
    .select({ status: table.status, total: count() })
    .from(table)
    .groupBy(table.status);
  const counts = { draft: 0, published: 0, archived: 0 };
  for (const row of rows) counts[row.status] = Number(row.total);
  return counts;
}

async function pendingImportJobs(): Promise<ImportJobSummary[]> {
  const rows = await getDb()
    .select()
    .from(importJobs)
    .where(
      and(
        eq(importJobs.status, "dry_run"),
        gt(importJobs.expiresAt, sql`now()`),
        isNull(importJobs.committedAt),
      ),
    )
    .orderBy(desc(importJobs.createdAt))
    .limit(20);
  return rows.map((row) => ({
    id: row.id,
    filename: row.filename,
    rowCount: row.rowCount,
    summary: {
      create: row.createCount,
      update: row.updateCount,
      skip: row.skipCount,
      error: row.errorCount,
    },
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  }));
}

/** Counts per entity and status, the newest drafts, recent audit entries and open imports. */
export async function getDashboard(ctx: ReadContext): Promise<Dashboard> {
  assertEditor(ctx);
  const db = getDb();

  const [countRows, draftPages, audit, pendingImports] = await Promise.all([
    Promise.all(ADMIN_ENTITIES.map(statusCounts)),
    Promise.all(
      ADMIN_ENTITIES.map(async (entity) => ({
        entity,
        page: await listRecords(ctx, entity, {
          status: "draft",
          limit: DRAFT_QUEUE_SIZE,
        }),
      })),
    ),
    db
      .select({
        id: auditLog.id,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        action: auditLog.action,
        actorEmail: users.email,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorId))
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(RECENT_AUDIT_SIZE),
    pendingImportJobs(),
  ]);

  const counts = Object.fromEntries(
    ADMIN_ENTITIES.map((entity, index) => [entity, countRows[index]]),
  ) as Record<AdminEntity, StatusCounts>;

  const drafts = draftPages
    .flatMap(({ entity, page }) =>
      page.data.map((item) => ({ ...item, entity })),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, DRAFT_QUEUE_SIZE);

  return {
    counts,
    drafts,
    recentAudit: audit.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    })),
    pendingImports,
  };
}

export type IndustryOption = Readonly<{
  id: string;
  slug: string;
  name: string;
}>;

export type LocationOption = Readonly<{
  id: string;
  slug: string;
  label: string;
}>;

export type Lookups = Readonly<{
  industries: readonly IndustryOption[];
  locations: readonly LocationOption[];
}>;

/** Every industry and location, for the pickers in the entity forms. Both are small tables. */
export async function getLookups(ctx: ReadContext): Promise<Lookups> {
  assertEditor(ctx);
  const db = getDb();
  const [industryRows, locationRows] = await Promise.all([
    db
      .select({
        id: industries.id,
        slug: industries.slug,
        name: industries.name,
      })
      .from(industries)
      .orderBy(asc(industries.name)),
    db
      .select({
        id: locations.id,
        slug: locations.slug,
        city: locations.city,
        country: locations.country,
      })
      .from(locations)
      .orderBy(asc(locations.country), asc(locations.city)),
  ]);
  return {
    industries: industryRows,
    locations: locationRows.map((row) => ({
      id: row.id,
      slug: row.slug,
      label: row.city ? `${row.city}, ${row.country}` : row.country,
    })),
  };
}

export type MediaItem = Readonly<{
  id: string;
  purpose: "logo" | "cover" | "photo" | "og";
  state: "staging" | "attached";
  image: Image | null;
  sourceUrl: string | null;
  createdAt: string;
  attachedAt: string | null;
}>;

const MEDIA_PAGE_SIZE = 60;

/** The newest assets, staging first when asked: what an editor needs to find an upload (FR-207). */
export async function listMedia(
  ctx: ReadContext,
  input: Readonly<{ state?: "staging" | "attached" }> = {},
): Promise<MediaItem[]> {
  assertEditor(ctx);
  const rows = await getDb()
    .select()
    .from(mediaAssets)
    .where(input.state ? eq(mediaAssets.state, input.state) : undefined)
    .orderBy(desc(mediaAssets.createdAt), desc(mediaAssets.id))
    .limit(MEDIA_PAGE_SIZE);
  return rows.map((row) => ({
    id: row.id,
    purpose: row.purpose,
    state: row.state,
    image: toImage({ variants: row.variants, blurDataUrl: row.blurDataUrl }),
    sourceUrl: row.sourceUrl,
    createdAt: row.createdAt.toISOString(),
    attachedAt: row.attachedAt?.toISOString() ?? null,
  }));
}

export type CategoryCopy = Readonly<{
  kind: string;
  slug: string;
  heading: string | null;
  intro: string | null;
  iconUrl: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  sortOrder: number;
}>;

/** The editor-written copy that exists, keyed `kind/slug`; values without a row use generated copy. */
export async function listCategoryCopy(
  ctx: ReadContext,
): Promise<Record<string, CategoryCopy>> {
  assertEditor(ctx);
  const rows = await getDb().select().from(taxonomyPages);
  return Object.fromEntries(
    rows.map((row) => [
      `${row.kind}/${row.slug}`,
      {
        kind: row.kind,
        slug: row.slug,
        heading: row.heading,
        intro: row.intro,
        iconUrl: row.iconUrl,
        seoTitle: row.seoTitle,
        seoDescription: row.seoDescription,
        sortOrder: row.sortOrder,
      },
    ]),
  );
}

/** Previews for the assets a form already references, keyed by asset id. */
export async function getAssetImages(
  ctx: ReadContext,
  ids: readonly string[],
): Promise<Record<string, Image>> {
  assertEditor(ctx);
  const wanted = [...new Set(ids.filter(isUuid))];
  if (wanted.length === 0) return {};
  const rows = await getDb()
    .select({
      id: mediaAssets.id,
      variants: mediaAssets.variants,
      blurDataUrl: mediaAssets.blurDataUrl,
    })
    .from(mediaAssets)
    .where(inArray(mediaAssets.id, wanted));
  const images: Record<string, Image> = {};
  for (const row of rows) {
    const image = toImage(row);
    if (image) images[row.id] = image;
  }
  return images;
}
