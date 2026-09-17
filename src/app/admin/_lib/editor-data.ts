import "server-only";

import type { AuthedContext } from "@/server/auth/context";
import { NotFoundError } from "@/server/lib/errors";
import { getAssetImages, getLookups } from "@/server/services/admin-panel";
import { getRecord } from "@/server/services/admin-reads";
import type { AdminEntity, AdminRecord } from "@/types/admin";

// What an entity form needs besides the record: pick lists, previews of the images it already
// references, and names for the records its id fields point at.

const MEDIA_KEYS = ["logoAssetId", "coverAssetId", "photoAssetId"];
const REFERENCES: Record<string, AdminEntity> = {
  acquiredByStartupId: "startup",
  investorId: "investor",
  startupId: "startup",
};

function nameOf(record: AdminRecord): string {
  const values = record.values;
  const text = (key: string) =>
    typeof values[key] === "string" ? String(values[key]) : "";
  if (record.entity === "founder") return text("fullName");
  if (record.entity === "batch")
    return `${text("programName")} ${text("label")}`.trim();
  return text("name");
}

export async function recordOrNull(
  ctx: AuthedContext,
  entity: AdminEntity,
  id: string,
): Promise<AdminRecord | null> {
  try {
    return await getRecord(ctx, entity, id);
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

export async function editorData(
  ctx: AuthedContext,
  record: AdminRecord | null,
) {
  const values = { ...(record?.values ?? {}), ...(record?.derived ?? {}) };
  const assetIds = MEDIA_KEYS.map((key) => values[key]).filter(
    (value): value is string => typeof value === "string",
  );
  const references = Object.entries(REFERENCES).flatMap(([key, entity]) =>
    typeof values[key] === "string"
      ? [{ id: String(values[key]), entity }]
      : [],
  );
  const [lookups, previews, named] = await Promise.all([
    getLookups(ctx),
    getAssetImages(ctx, assetIds),
    Promise.all(
      references.map(({ id, entity }) => recordOrNull(ctx, entity, id)),
    ),
  ]);
  const names: Record<string, string> = {};
  for (const referenced of named) {
    if (referenced) names[referenced.id] = nameOf(referenced);
  }
  return { lookups, previews, names };
}
