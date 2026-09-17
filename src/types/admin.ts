import type { Image } from "./public";

// The admin panel's shapes (docs/API.md §7.10, §8), for components on the admin origin only.
// Declared here because nothing outside src/server may import from it (SEC-01);
// src/server/dto/admin-types.test.ts fails the typecheck if these and the services disagree.

export type RecordStatus = "draft" | "published" | "archived";

export type AdminEntity =
  | "startup"
  | "founder"
  | "investor"
  | "batch"
  | "round";

export type AdminListItem = Readonly<{
  id: string;
  slug: string | null;
  name: string;
  subtitle: string | null;
  status: RecordStatus;
  updatedAt: string;
  firstPublishedAt: string | null;
}>;

export type AdminRecord = Readonly<{
  entity: AdminEntity;
  id: string;
  slug: string | null;
  status: RecordStatus;
  firstPublishedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  values: Record<string, unknown>;
  derived: Record<string, unknown>;
  links?: Record<string, readonly unknown[]>;
}>;

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

export type MediaItem = Readonly<{
  id: string;
  purpose: "logo" | "cover" | "photo" | "og";
  state: "staging" | "attached";
  image: Image | null;
  sourceUrl: string | null;
  createdAt: string;
  attachedAt: string | null;
}>;

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

/** docs/API.md §8.5. */
export type UploadedAsset = Readonly<{
  assetId: string;
  state: "staging";
  purpose: "logo" | "cover" | "photo";
  image: Image;
}>;

/** docs/API.md §8.6. */
export type PrefillAsset = Readonly<{
  assetId: string;
  state: "staging";
  image: Image;
}>;

export type Confidence = "high" | "medium" | "low";

export type PrefillDraft = Readonly<{
  name: string | null;
  tagline: string | null;
  description: string | null;
  websiteUrl: string;
  careersUrl: string | null;
  logo: PrefillAsset | null;
  cover: PrefillAsset | null;
  locationGuess: Readonly<{
    raw: string;
    matchedLocationId: string | null;
  }> | null;
  links: Readonly<{
    linkedin: string | null;
    x: string | null;
    github: string | null;
  }>;
  confidence: Readonly<{
    name: Confidence;
    tagline: Confidence;
    description: Confidence;
  }>;
  source: "opengraph" | "json-ld" | "html" | "firecrawl";
  warnings: string[];
}>;

/** docs/API.md §8.7. */
export type RowAction = "create" | "update" | "skip" | "error";

export type ReportedRow = Readonly<{
  row: number;
  action: RowAction;
  name: string;
  slug: string | null;
  reason?: string;
  errors?: Readonly<{ path: string; message: string }>[];
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

/** docs/API.md §8.8. */
export type AdminUser = Readonly<{
  id: string;
  email: string;
  name: string;
  role: "admin" | "editor";
  twoFactorEnabled: boolean;
  deactivatedAt: string | null;
  createdAt: string;
}>;

/** docs/API.md §8.9. */
export type PrivacyRequest = Readonly<{
  id: string;
  requestType: "access" | "correction" | "erasure" | "objection";
  status: "open" | "completed" | "rejected";
  subjectEntityType: string;
  subjectEntityId: string | null;
  receivedAt: string;
  dueAt: string;
  notes: string | null;
  resolvedAt: string | null;
}>;
