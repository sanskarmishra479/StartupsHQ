import "server-only";

import type { LocationSummary } from "./startup";

export type LocationFields = {
  locationSlug: string | null;
  city: string | null;
  country: string | null;
  countryCode: string | null;
};

/** A left-joined location as a summary; null when the entity has no location. */
export function toLocationSummary(row: LocationFields): LocationSummary | null {
  if (
    row.locationSlug === null ||
    row.country === null ||
    row.countryCode === null
  ) {
    return null;
  }
  return {
    slug: row.locationSlug,
    city: row.city,
    country: row.country,
    countryCode: row.countryCode,
  };
}
