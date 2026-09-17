// The five directory entities as the admin panel names and routes them. Client-safe.

export const ADMIN_ENTITY_KINDS = [
  "startup",
  "founder",
  "investor",
  "batch",
  "round",
] as const;

export type AdminEntityKind = (typeof ADMIN_ENTITY_KINDS)[number];

export type RecordStatus = "draft" | "published" | "archived";

type EntityInfo = Readonly<{
  /** The URL segment, which is also the API collection: /admin/startups, /api/v1/startups. */
  segment: string;
  singular: string;
  plural: string;
  /** The public page for a published record, when the entity has one. */
  publicPath?: (slug: string) => string;
}>;

export const ENTITY_INFO: Record<AdminEntityKind, EntityInfo> = {
  startup: {
    segment: "startups",
    singular: "Startup",
    plural: "Startups",
    publicPath: (slug) => `/companies/${slug}`,
  },
  founder: {
    segment: "founders",
    singular: "Founder",
    plural: "Founders",
    publicPath: (slug) => `/founders/${slug}`,
  },
  investor: {
    segment: "investors",
    singular: "Investor",
    plural: "Investors",
    publicPath: (slug) => `/investors/${slug}`,
  },
  batch: {
    segment: "batches",
    singular: "Batch",
    plural: "Batches",
    publicPath: (slug) => `/batches/${slug}`,
  },
  round: { segment: "rounds", singular: "Round", plural: "Rounds" },
};

export function entityForSegment(segment: string): AdminEntityKind | null {
  return (
    ADMIN_ENTITY_KINDS.find((kind) => ENTITY_INFO[kind].segment === segment) ??
    null
  );
}

export const adminPaths = {
  list: (kind: AdminEntityKind) => `/admin/${ENTITY_INFO[kind].segment}`,
  create: (kind: AdminEntityKind) => `/admin/${ENTITY_INFO[kind].segment}/new`,
  edit: (kind: AdminEntityKind, id: string) =>
    `/admin/${ENTITY_INFO[kind].segment}/${id}`,
  api: (kind: AdminEntityKind, id?: string) =>
    `/api/v1/${ENTITY_INFO[kind].segment}${id ? `/${id}` : ""}`,
};

export const STATUS_LABELS: Record<RecordStatus, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};

/**
 * A public page's full URL. The admin origin serves no public pages (ADR-014), so links to them
 * name the public origin, which the build inlines from NEXT_PUBLIC_SITE_URL.
 */
export function publicUrl(path: string): string {
  const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  return `${origin}${path}`;
}
