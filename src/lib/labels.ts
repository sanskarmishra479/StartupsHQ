// Human-readable labels for enum values, and the enum ⟷ URL slug mapping (`series_a` ⟷
// `series-a`). Client-safe: shared by server DTOs and UI components.

export const STAGE_LABELS = {
  bootstrapped: "Bootstrapped",
  pre_seed: "Pre-seed",
  seed: "Seed",
  series_a: "Series A",
  series_b: "Series B",
  series_c: "Series C",
  series_d: "Series D",
  series_e: "Series E",
  series_f: "Series F",
  series_g: "Series G",
  growth: "Growth",
  public: "Public",
  acquired: "Acquired",
  dead: "Shut down",
} as const;

export const WORK_TYPE_LABELS = {
  remote: "Remote",
  onsite: "On-site",
  hybrid: "Hybrid",
} as const;

export const INVESTOR_TYPE_LABELS = {
  vc: "VC",
  accelerator: "Accelerator",
  angel: "Angel",
  corporate: "Corporate VC",
  pe: "Private equity",
  government: "Government",
  crowdfunding: "Crowdfunding",
} as const;

function labelFrom<Labels extends Record<string, string>>(
  labels: Labels,
  value: string,
): string | undefined {
  return Object.hasOwn(labels, value) ? labels[value] : undefined;
}

export const stageLabel = (value: string) => labelFrom(STAGE_LABELS, value);
export const workTypeLabel = (value: string) =>
  labelFrom(WORK_TYPE_LABELS, value);
export const investorTypeLabel = (value: string) =>
  labelFrom(INVESTOR_TYPE_LABELS, value);

/** `series_a` → `series-a`. */
export function enumToSlug(value: string): string {
  return value.replaceAll("_", "-");
}

/** `series-a` → `series_a` when that is one of `values`; `series_a` itself is not a valid slug. */
export function slugToEnum<T extends string>(
  slug: string,
  values: readonly T[],
): T | undefined {
  if (slug.includes("_")) return undefined;
  const value = slug.replaceAll("-", "_");
  return values.find((candidate) => candidate === value);
}
