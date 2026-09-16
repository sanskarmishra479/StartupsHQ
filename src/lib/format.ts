// Presentation helpers for entity pages. Client-safe and pure; dates are formatted in UTC so the
// server's prerender and the browser always agree.

const dayFormat = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const monthFormat = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "2026-09-10" → "Sep 10, 2026"; anything else is returned unchanged. */
export function formatDate(value: string): string {
  const date = parseIsoDate(value);
  return date ? dayFormat.format(date) : value;
}

/** "2026-09-10" → "September 2026", for grouping the news feed. */
export function formatMonth(value: string): string {
  const date = parseIsoDate(value);
  return date ? monthFormat.format(date) : value;
}

/** A founder's time at a company: "2019–2023", "2021–present", "Until 2020", or null. */
export function formatTenure(
  joinedYear: number | null,
  leftYear: number | null,
  isCurrent: boolean,
): string | null {
  if (joinedYear !== null && leftYear !== null) {
    return joinedYear === leftYear
      ? String(joinedYear)
      : `${joinedYear}–${leftYear}`;
  }
  if (joinedYear !== null)
    return isCurrent ? `${joinedYear}–present` : `Since ${joinedYear}`;
  if (leftYear !== null) return `Until ${leftYear}`;
  return null;
}

/** "51-200" → "51–200 people". */
export function formatHeadcount(band: string | null): string | null {
  if (!band) return null;
  return `${band.replace("-", "–")} people`;
}

/**
 * An editor-entered link, only if it is plain http(s). Writes already require https (SEC-06);
 * this keeps a `javascript:` URL from ever becoming an href should one slip into the data.
 */
export function safeExternalUrl(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/** "https://www.highstock.com/about" → "highstock.com". */
export function displayHost(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}
