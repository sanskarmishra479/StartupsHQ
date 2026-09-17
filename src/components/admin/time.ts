// Timestamps in the admin panel: exact in UTC, so two editors in different places agree. Client-safe.

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

export const formatTimestamp = (iso: string) =>
  `${DATE_TIME.format(new Date(iso))} UTC`;
