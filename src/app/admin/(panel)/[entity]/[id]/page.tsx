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
import { Money } from "@/components/data/Money";
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
  const derived = record.derived;
  const conversion =
    kind === "round" ? (
      <section
        aria-labelledby="conversion"
        className="flex flex-col gap-2 rounded-md border border-border p-4 text-sm"
      >
        <h2 id="conversion" className="meta text-fg-subtle">
          Computed on save
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-fg-subtle">US dollars</dt>
          <dd>
            {typeof derived.amountUsd === "number" ? (
              <Money amountUsd={derived.amountUsd} />
            ) : (
              "—"
            )}
          </dd>
          <dt className="text-fg-subtle">Rate</dt>
          <dd className="font-mono">
            {typeof derived.fxRate === "string" ? derived.fxRate : "—"}
          </dd>
          <dt className="text-fg-subtle">Rate date</dt>
          <dd>
            {typeof derived.fxRateDate === "string" ? derived.fxRateDate : "—"}
          </dd>
          <dt className="text-fg-subtle">Source</dt>
          <dd>
            {derived.fxSource === "manual"
              ? "Manual (admin)"
              : derived.fxSource === "ecb"
                ? "ECB"
                : "—"}
          </dd>
          <dt className="text-fg-subtle">Counts as</dt>
          <dd>
            {typeof derived.roundClass === "string"
              ? derived.roundClass.replace("_", "-")
              : "—"}
          </dd>
        </dl>
      </section>
    ) : undefined;

  return (
    <EntityEditor
      aside={conversion}
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
