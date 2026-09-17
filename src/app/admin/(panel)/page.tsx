import type { Metadata } from "next";
import Link from "next/link";
import {
  ADMIN_ENTITY_KINDS,
  adminPaths,
  ENTITY_INFO,
} from "@/components/admin/entities";
import { PageHeader } from "@/components/admin/PageHeader";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { formatTimestamp } from "@/components/admin/time";
import { PillButton } from "@/components/ui/PillButton";
import { getDashboard } from "@/server/services/admin-panel";
import { requirePanel } from "../_lib/session";

// FR-202: counts per entity, the draft queue, recent audit entries and pending imports.

export const metadata: Metadata = { title: "Dashboard" };

const ACTION_LABELS: Record<string, string> = {
  create: "created",
  update: "edited",
  archive: "archived",
  restore: "restored",
  publish: "published",
  unpublish: "unpublished",
  slug_change: "changed the slug of",
  hard_delete: "deleted",
  erase: "erased",
  invite: "invited",
  role_change: "changed the role of",
  reset_two_factor: "reset two-factor for",
  deactivate: "deactivated",
  reactivate: "reactivated",
};

export default async function DashboardPage() {
  const { ctx } = await requirePanel();
  const dashboard = await getDashboard(ctx);

  return (
    <>
      <PageHeader
        title="Dashboard"
        actions={
          <>
            <PillButton href="/admin/import" variant="outline" size="sm">
              Import CSV
            </PillButton>
            <PillButton href={adminPaths.create("startup")} size="sm">
              New startup
            </PillButton>
          </>
        }
      />

      <section aria-labelledby="counts" className="flex flex-col gap-3">
        <h2 id="counts" className="sr-only">
          Records
        </h2>
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {ADMIN_ENTITY_KINDS.map((kind) => {
            const counts = dashboard.counts[kind];
            return (
              <li key={kind}>
                <Link
                  href={adminPaths.list(kind)}
                  prefetch={false}
                  className="flex flex-col gap-2 rounded-md border border-border p-4 hover:bg-surface-hover"
                >
                  <span className="meta text-fg-subtle">
                    {ENTITY_INFO[kind].plural}
                  </span>
                  <span className="font-medium text-2xl tabular-nums">
                    {counts.published}
                    <span className="sr-only"> published</span>
                  </span>
                  <span className="text-fg-muted text-xs tabular-nums">
                    {counts.draft} draft · {counts.archived} archived
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section aria-labelledby="drafts" className="flex flex-col gap-3">
          <h2 id="drafts" className="font-medium text-lg">
            Draft queue
          </h2>
          {dashboard.drafts.length === 0 ? (
            <p className="text-fg-muted text-sm">Nothing waiting to publish.</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {dashboard.drafts.map((item) => (
                <li key={`${item.entity}:${item.id}`}>
                  <Link
                    href={adminPaths.edit(item.entity, item.id)}
                    prefetch={false}
                    className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-hover"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm">{item.name}</span>
                      <span className="meta text-fg-subtle">
                        {ENTITY_INFO[item.entity].singular} ·{" "}
                        {formatTimestamp(item.updatedAt)}
                      </span>
                    </span>
                    <StatusBadge status={item.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="audit" className="flex flex-col gap-3">
          <h2 id="audit" className="font-medium text-lg">
            Recent activity
          </h2>
          {dashboard.recentAudit.length === 0 ? (
            <p className="text-fg-muted text-sm">No changes yet.</p>
          ) : (
            <ol className="flex flex-col divide-y divide-border rounded-md border border-border">
              {dashboard.recentAudit.map((entry) => (
                <li key={entry.id} className="flex flex-col gap-0.5 px-3 py-2">
                  <span className="text-sm">
                    {entry.actorEmail ?? "System"}{" "}
                    <span className="text-fg-muted">
                      {ACTION_LABELS[entry.action] ?? entry.action}
                    </span>{" "}
                    a {entry.entityType.replaceAll("_", " ")}
                  </span>
                  <span className="meta text-fg-subtle">
                    {formatTimestamp(entry.createdAt)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <section aria-labelledby="imports" className="flex flex-col gap-3">
        <h2 id="imports" className="font-medium text-lg">
          Pending imports
        </h2>
        {dashboard.pendingImports.length === 0 ? (
          <p className="text-fg-muted text-sm">
            No dry runs waiting to be committed.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {dashboard.pendingImports.map((job) => (
              <li
                key={job.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm">{job.filename}</span>
                  <span className="meta text-fg-subtle">
                    {job.summary.create} create · {job.summary.update} update ·{" "}
                    {job.summary.skip} skip · {job.summary.error} error ·
                    expires {formatTimestamp(job.expiresAt)}
                  </span>
                </span>
                <PillButton
                  href={`/admin/import?job=${job.id}`}
                  variant="outline"
                  size="sm"
                >
                  Review
                </PillButton>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
