import "server-only";

import type { MediaVariant } from "../db/schema/media";
import { type Image, toImage } from "./image";
import { type LocationFields, toLocationSummary } from "./location";
import type { FounderRole, LocationSummary, StartupCard } from "./startup";

// docs/API.md §7.4. Founders are people: only the fields the page renders leave the server
// (SEC-15, SEC-18).

export type Founder = Readonly<{
  slug: string;
  fullName: string;
  headline: string | null;
  bio: string | null;
  photo: Image | null;
  links: Readonly<{
    linkedin: string | null;
    x: string | null;
    github: string | null;
    personal: string | null;
  }>;
  location: LocationSummary | null;
  startups: readonly Readonly<{
    startup: StartupCard;
    role: FounderRole;
    isCurrent: boolean;
    joinedYear: number | null;
    leftYear: number | null;
  }>[];
  /** Distinct visible startups; a founder can hold several stints at one company (DM-10). */
  startupCount: number;
  ogImageUrl: string | null;
  updatedAt: string;
}>;

export type FounderRow = LocationFields & {
  slug: string;
  fullName: string;
  headline: string | null;
  bio: string | null;
  photoVariants: MediaVariant[] | null;
  photoBlur: string | null;
  linkedinUrl: string | null;
  xUrl: string | null;
  githubUrl: string | null;
  personalUrl: string | null;
  ogVariants: MediaVariant[] | null;
  updatedAt: Date;
};

export type FounderStintRow = {
  startupId: string;
  role: FounderRole;
  isCurrent: boolean;
  joinedYear: number | null;
  leftYear: number | null;
};

export function toFounder(
  row: FounderRow,
  stints: readonly FounderStintRow[],
  cards: ReadonlyMap<string, StartupCard>,
): Founder {
  const visible = stints.filter((stint) => cards.has(stint.startupId));
  return {
    slug: row.slug,
    fullName: row.fullName,
    headline: row.headline,
    bio: row.bio,
    photo: toImage({ variants: row.photoVariants, blurDataUrl: row.photoBlur }),
    links: {
      linkedin: row.linkedinUrl,
      x: row.xUrl,
      github: row.githubUrl,
      personal: row.personalUrl,
    },
    location: toLocationSummary(row),
    startups: visible.map((stint) => ({
      startup: cards.get(stint.startupId) as StartupCard,
      role: stint.role,
      isCurrent: stint.isCurrent,
      joinedYear: stint.joinedYear,
      leftYear: stint.leftYear,
    })),
    startupCount: new Set(visible.map((stint) => stint.startupId)).size,
    ogImageUrl:
      toImage({ variants: row.ogVariants, blurDataUrl: null })?.url ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}
