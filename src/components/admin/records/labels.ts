import { roundTypeLabel } from "@/lib/labels";
import type { AdminEntity, AdminListItem } from "@/types/admin";

// Display names for admin list rows. Client-safe.

/** A round's list name arrives as `series_a · 2026-09-10`; show it as `Series A · 2026-09-10`. */
export function displayName(
  kind: AdminEntity,
  item: Pick<AdminListItem, "name">,
) {
  if (kind !== "round") return item.name;
  const [type = "", ...rest] = item.name.split(" · ");
  return [roundTypeLabel(type), ...rest].join(" · ");
}
