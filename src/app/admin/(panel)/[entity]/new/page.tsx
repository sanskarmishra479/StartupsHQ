import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EntityEditor } from "@/components/admin/editor/EntityEditor";
import { ENTITY_INFO, entityForSegment } from "@/components/admin/entities";
import { StartupEditor } from "@/components/admin/startup/StartupEditor";
import { editorData } from "../../../_lib/editor-data";
import { requirePanel } from "../../../_lib/session";

// FR-204: a new record starts as a draft. Rounds are created from their startup's page.

export async function generateMetadata({
  params,
}: PageProps<"/admin/[entity]/new">): Promise<Metadata> {
  const kind = entityForSegment((await params).entity);
  return kind
    ? { title: `New ${ENTITY_INFO[kind].singular.toLowerCase()}` }
    : {};
}

export default async function NewRecordPage({
  params,
}: PageProps<"/admin/[entity]/new">) {
  const { ctx, isAdmin } = await requirePanel();
  const kind = entityForSegment((await params).entity);
  if (!kind || kind === "round") notFound();
  const data = await editorData(ctx, null);
  return kind === "startup" ? (
    <StartupEditor record={null} isAdmin={isAdmin} {...data} />
  ) : (
    <EntityEditor kind={kind} record={null} isAdmin={isAdmin} {...data} />
  );
}
