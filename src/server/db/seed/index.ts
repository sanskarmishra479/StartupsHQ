import "server-only";

import { eq, sql } from "drizzle-orm";
import type { Database } from "../client";
import { recomputeStartupDerived } from "../derived";
import {
  auditLog,
  batches,
  founders,
  fundingRounds,
  fxRates,
  industries,
  investments,
  investors,
  locations,
  type MediaVariant,
  mediaAssets,
  slugRedirects,
  startupBatches,
  startupFounders,
  startupIndustries,
  startups,
  taxonomyPages,
} from "../schema";
import {
  AUDIT_ENTRIES,
  BACKERS_WITHOUT_ROUND,
  BATCHES,
  FOUNDERS,
  FX_RATES,
  INDUSTRIES,
  INVESTORS,
  LOCATIONS,
  MEDIA,
  REDIRECTS,
  ROUNDS,
  type SeedMedia,
  STARTUPS,
  STINTS,
  TAXONOMY,
} from "./fixtures";

/** Every table the seed owns. Auth tables (users, sessions, …) are never touched. */
const SEEDED_TABLES = [
  "audit_log",
  "erasure_log",
  "import_jobs",
  "slug_redirects",
  "taxonomy_pages",
  "fx_rates",
  "startup_industries",
  "startup_batches",
  "startup_founders",
  "investments",
  "funding_rounds",
  "startups",
  "founders",
  "batches",
  "investors",
  "media_assets",
  "industries",
  "locations",
] as const;

const HOUR_MS = 3_600_000;
/** Fixed base for created_at, so keyset ordering is identical on every seed. */
const BASE_CREATED_AT_MS = Date.parse("2026-01-01T00:00:00Z");
/** A syntactically valid placeholder, not a real image. */
const BLUR_PLACEHOLDER = "data:image/webp;base64,UklGRiQAAABXRUJQVlA4";

const VARIANT_WIDTHS: Record<SeedMedia["purpose"], readonly number[]> = {
  logo: [64, 128, 256],
  cover: [640, 1280, 1920],
  photo: [128, 256, 512],
  og: [1200],
};

function variantsFor(media: SeedMedia): MediaVariant[] {
  return VARIANT_WIDTHS[media.purpose].map((width) => ({
    width,
    height:
      media.purpose === "cover"
        ? Math.round((width * 9) / 16)
        : media.purpose === "og"
          ? 630
          : width,
    url: `https://example.com/blob/${media.blobPrefix}/${width}.webp`,
    bytes: width * 12,
  }));
}

function lookup(ids: ReadonlyMap<string, string>, key: string, kind: string) {
  const id = ids.get(key);
  if (!id) throw new Error(`Seed fixture references unknown ${kind} "${key}".`);
  return id;
}

const byKey = <K extends string>(
  rows: readonly ({ id: string } & Record<K, string>)[],
  key: K,
) => new Map(rows.map((row) => [row[key], row.id]));

export type SeedSummary = Record<(typeof SEEDED_TABLES)[number], number>;

/**
 * Replaces all directory content with the fictional fixtures, in one transaction.
 * Idempotent: running it twice leaves identical content.
 */
export async function seed(
  db: Database,
  now: Date = new Date(),
): Promise<SeedSummary> {
  const createdAt = (index: number) =>
    new Date(BASE_CREATED_AT_MS + index * HOUR_MS);
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * HOUR_MS);

  return db.transaction(async (tx) => {
    await tx.execute(
      sql.raw(
        `TRUNCATE TABLE ${SEEDED_TABLES.map((table) => `public.${table}`).join(", ")} RESTART IDENTITY CASCADE`,
      ),
    );

    const locationIds = byKey(
      await tx
        .insert(locations)
        .values(LOCATIONS)
        .returning({ id: locations.id, slug: locations.slug }),
      "slug",
    );

    const industryIds = byKey(
      await tx
        .insert(industries)
        .values(INDUSTRIES)
        .returning({ id: industries.id, slug: industries.slug }),
      "slug",
    );

    const mediaIds = byKey(
      await tx
        .insert(mediaAssets)
        .values(
          MEDIA.map((media) => ({
            blobPrefix: media.blobPrefix,
            purpose: media.purpose,
            state: media.state,
            variants: variantsFor(media),
            blurDataUrl: BLUR_PLACEHOLDER,
            createdAt: hoursAgo(media.ageHours),
            attachedAt:
              media.attachedAgeHours === undefined
                ? null
                : hoursAgo(media.attachedAgeHours),
          })),
        )
        .returning({ id: mediaAssets.id, blobPrefix: mediaAssets.blobPrefix }),
      "blobPrefix",
    );

    const investorIds = byKey(
      await tx
        .insert(investors)
        .values(
          INVESTORS.map(({ hq, ...row }, index) => ({
            ...row,
            hqLocationId: hq ? lookup(locationIds, hq, "location") : null,
            createdAt: createdAt(index),
          })),
        )
        .returning({ id: investors.id, slug: investors.slug }),
      "slug",
    );

    const batchIds = byKey(
      await tx
        .insert(batches)
        .values(
          BATCHES.map(({ investor, ...row }, index) => ({
            ...row,
            investorId: investor
              ? lookup(investorIds, investor, "investor")
              : null,
            createdAt: createdAt(index),
          })),
        )
        .returning({ id: batches.id, slug: batches.slug }),
      "slug",
    );

    // An in-database acquisition references another startup, so it is applied in a second pass.
    const startupIds = byKey(
      await tx
        .insert(startups)
        .values(
          STARTUPS.map(
            (
              {
                location,
                acquiredBy,
                acquiredOn,
                acquiredAmountUsd,
                industries: startupIndustryRefs,
                batches: batchRefs,
                logo,
                ...row
              },
              index,
            ) => ({
              ...row,
              acquiredOn: acquiredBy ? null : acquiredOn,
              acquiredAmountUsd: acquiredBy ? null : acquiredAmountUsd,
              locationId: location
                ? lookup(locationIds, location, "location")
                : null,
              logoAssetId: logo ? lookup(mediaIds, logo, "media asset") : null,
              createdAt: createdAt(index),
            }),
          ),
        )
        .returning({ id: startups.id, slug: startups.slug }),
      "slug",
    );

    for (const startup of STARTUPS) {
      if (!startup.acquiredBy) continue;
      await tx
        .update(startups)
        .set({
          acquiredByStartupId: lookup(
            startupIds,
            startup.acquiredBy,
            "startup",
          ),
          acquiredOn: startup.acquiredOn,
          acquiredAmountUsd: startup.acquiredAmountUsd,
        })
        .where(eq(startups.id, lookup(startupIds, startup.slug, "startup")));
    }

    const founderIds = byKey(
      await tx
        .insert(founders)
        .values(
          FOUNDERS.map(({ location, ...row }, index) => ({
            ...row,
            locationId: location
              ? lookup(locationIds, location, "location")
              : null,
            createdAt: createdAt(index),
          })),
        )
        .returning({ id: founders.id, slug: founders.slug }),
      "slug",
    );

    // Source URLs are unique per fixture round, so they key the id lookup.
    const roundIds = byKey(
      await tx
        .insert(fundingRounds)
        .values(
          ROUNDS.map(
            ({ startup, investors: _participants, ...row }, index) => ({
              ...row,
              startupId: lookup(startupIds, startup, "startup"),
              createdAt: createdAt(index),
            }),
          ),
        )
        .returning({
          id: fundingRounds.id,
          sourceUrl: fundingRounds.sourceUrl,
        }),
      "sourceUrl",
    );

    const investmentRows = [
      ...ROUNDS.flatMap((round) =>
        (round.investors ?? []).map((participant) => ({
          startupId: lookup(startupIds, round.startup, "startup"),
          investorId: lookup(investorIds, participant.slug, "investor"),
          roundId: lookup(roundIds, round.sourceUrl, "round"),
          isLead: participant.lead ?? false,
        })),
      ),
      ...BACKERS_WITHOUT_ROUND.map((backer) => ({
        startupId: lookup(startupIds, backer.startup, "startup"),
        investorId: lookup(investorIds, backer.investor, "investor"),
        roundId: null,
        isLead: false,
      })),
    ];
    await tx.insert(investments).values(investmentRows);

    await tx.insert(startupFounders).values(
      STINTS.map(({ startup, founder, ...stint }) => ({
        ...stint,
        startupId: lookup(startupIds, startup, "startup"),
        founderId: lookup(founderIds, founder, "founder"),
        sourceUrl: `https://example.com/sources/${founder}-${startup}`,
      })),
    );

    const batchRows = STARTUPS.flatMap((startup) =>
      (startup.batches ?? []).map((batch) => ({
        startupId: lookup(startupIds, startup.slug, "startup"),
        batchId: lookup(batchIds, batch, "batch"),
      })),
    );
    await tx.insert(startupBatches).values(batchRows);

    const industryRows = STARTUPS.flatMap((startup) =>
      startup.industries.map((industry) => ({
        startupId: lookup(startupIds, startup.slug, "startup"),
        industryId: lookup(industryIds, industry.slug, "industry"),
        isPrimary: industry.primary ?? false,
      })),
    );
    await tx.insert(startupIndustries).values(industryRows);

    await tx.insert(slugRedirects).values(
      REDIRECTS.map(({ entity, ...redirect }) => ({
        ...redirect,
        entityId: lookup(startupIds, entity, "startup"),
      })),
    );

    await tx.insert(taxonomyPages).values(TAXONOMY);
    await tx.insert(fxRates).values(FX_RATES);

    await tx.insert(auditLog).values(
      AUDIT_ENTRIES.map(({ entity, ageDays, ...entry }) => ({
        ...entry,
        entityType: "startup",
        entityId: lookup(startupIds, entity, "startup"),
        createdAt: hoursAgo(ageDays * 24),
      })),
    );

    await recomputeStartupDerived(tx);

    return {
      audit_log: AUDIT_ENTRIES.length,
      erasure_log: 0,
      import_jobs: 0,
      slug_redirects: REDIRECTS.length,
      taxonomy_pages: TAXONOMY.length,
      fx_rates: FX_RATES.length,
      startup_industries: industryRows.length,
      startup_batches: batchRows.length,
      startup_founders: STINTS.length,
      investments: investmentRows.length,
      funding_rounds: ROUNDS.length,
      startups: STARTUPS.length,
      founders: FOUNDERS.length,
      batches: BATCHES.length,
      investors: INVESTORS.length,
      media_assets: MEDIA.length,
      industries: INDUSTRIES.length,
      locations: LOCATIONS.length,
    };
  });
}
