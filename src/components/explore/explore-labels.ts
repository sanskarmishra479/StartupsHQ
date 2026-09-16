import type { ExploreQuery } from "@/lib/explore-query";
import { stageLabel, workTypeLabel } from "@/lib/labels";
import type { CategoryDirectory, CategoryKind } from "@/types/public";

// Human names for the active filters, for the chips that remove them. Client-safe and pure.

export type ActiveFilter = Readonly<{
  key: string;
  label: string;
  /** The query without this one filter. */
  without: ExploreQuery;
}>;

function nameIn(
  directory: CategoryDirectory,
  kind: CategoryKind,
  match: (entry: { slug: string; countryCode?: string }) => boolean,
): string | undefined {
  return directory.find((group) => group.kind === kind)?.entries.find(match)
    ?.name;
}

const readable = (slug: string) => slug.replaceAll("-", " ");

export function activeFilters(
  query: ExploreQuery,
  directory: CategoryDirectory,
): ActiveFilter[] {
  const filters: ActiveFilter[] = [];
  for (const stage of query.stage) {
    filters.push({
      key: `stage:${stage}`,
      label: stageLabel(stage) ?? stage,
      without: { ...query, stage: query.stage.filter((s) => s !== stage) },
    });
  }
  for (const industry of query.industry) {
    filters.push({
      key: `industry:${industry}`,
      label:
        nameIn(directory, "industries", (e) => e.slug === industry) ??
        readable(industry),
      without: {
        ...query,
        industry: query.industry.filter((s) => s !== industry),
      },
    });
  }
  for (const workType of query.workType) {
    filters.push({
      key: `work_type:${workType}`,
      label: workTypeLabel(workType) ?? workType,
      without: {
        ...query,
        workType: query.workType.filter((s) => s !== workType),
      },
    });
  }
  for (const city of query.city) {
    filters.push({
      key: `city:${city}`,
      label:
        nameIn(directory, "cities", (e) => e.slug === city) ?? readable(city),
      without: { ...query, city: query.city.filter((s) => s !== city) },
    });
  }
  if (query.country) {
    const code = query.country;
    filters.push({
      key: `country:${code}`,
      label:
        nameIn(directory, "countries", (e) => e.countryCode === code) ?? code,
      without: { ...query, country: null },
    });
  }
  if (query.batch) {
    filters.push({
      key: "batch",
      label: `Batch: ${readable(query.batch)}`,
      without: { ...query, batch: null },
    });
  }
  if (query.investor) {
    filters.push({
      key: "investor",
      label: `Backed by ${readable(query.investor)}`,
      without: { ...query, investor: null },
    });
  }
  if (query.founder) {
    filters.push({
      key: "founder",
      label: `Founder: ${readable(query.founder)}`,
      without: { ...query, founder: null },
    });
  }
  if (query.includeAcquired) {
    filters.push({
      key: "include_acquired",
      label: "Including acquired",
      without: { ...query, includeAcquired: false },
    });
  }
  return filters;
}
