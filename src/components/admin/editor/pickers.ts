import { adminApi } from "@/lib/admin-api";
import type { AdminEntity, AdminListItem } from "@/types/admin";
import { adminPaths, STATUS_LABELS } from "../entities";
import { displayName } from "../records/labels";
import type { ComboOption } from "./Combobox";

// Loaders for record pickers: the admin list endpoint, searched by name. Client-safe.

const PICKER_LIMIT = 8;

/** A loader for `Combobox` that searches one entity's admin list, drafts included. */
export function recordLoader(entity: AdminEntity) {
  return async (query: string): Promise<ComboOption[]> => {
    const params = new URLSearchParams({ limit: String(PICKER_LIMIT) });
    if (query) params.set("q", query);
    const result = await adminApi<AdminListItem[]>(
      "GET",
      `${adminPaths.api(entity)}?${params}`,
    );
    if (!result.ok) return [];
    return result.data
      .filter((item) => item.status !== "archived")
      .map((item) => ({
        id: item.id,
        label: displayName(entity, item),
        detail: [
          item.status === "published" ? null : STATUS_LABELS[item.status],
          item.subtitle,
        ]
          .filter(Boolean)
          .join(" · "),
      }));
  };
}

/** A loader over a fixed list, matching every word typed anywhere in the label. */
export function localLoader(options: readonly ComboOption[], max = 30) {
  return (query: string): ComboOption[] => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return options
      .filter((option) => {
        const label = option.label.toLowerCase();
        return words.every((word) => label.includes(word));
      })
      .slice(0, max);
  };
}
