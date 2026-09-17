import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EntityEditor } from "@/components/admin/editor/EntityEditor";
import {
  adminPaths,
  ENTITY_INFO,
  entityForSegment,
} from "@/components/admin/entities";
import { StartupEditor } from "@/components/admin/startup/StartupEditor";
import { editorData, recordOrNull } from "../../../_lib/editor-data";
import { requirePanel } from "../../../_lib/session";

// FR-203, FR-204: one record, drafts and archived included.

export async function generateMetadata({
  params,
}: PageProps<"/admin/[entity]/[id]">): Promise<Metadata> {
  const kind = entityForSegment((await params).entity);
  return kind
    ? { title: `Edit ${ENTITY_INFO[kind].singular.toLowerCase()}` }
    : {};
}

export default async function EditRecordPage({
  params,
}: PageProps<"/admin/[entity]/[id]">) {
  const { ctx, isAdmin } = await requirePanel();
  const { entity, id } = await params;
  const kind = entityForSegment(entity);
  if (!kind) notFound();
  const record = await recordOrNull(ctx, kind, id);
  if (!record) notFound();
  const data = await editorData(ctx, record);

  if (kind === "startup") {
    return (
      <StartupEditor
        key={record.id}
        record={record}
        isAdmin={isAdmin}
        {...data}
      />
    );
  }

  const startupId =
    kind === "round" && typeof record.derived.startupId === "string"
      ? record.derived.startupId
      : null;
  return (
    <EntityEditor
      key={record.id}
      kind={kind}
      record={record}
      isAdmin={isAdmin}
      {...data}
      eyebrow={
        startupId ? (
          <Link
            href={adminPaths.edit("startup", startupId)}
            prefetch={false}
            className="hover:text-fg"
          >
            Round of {data.names[startupId] ?? "startup"}
          </Link>
        ) : undefined
      }
    />
  );
}
