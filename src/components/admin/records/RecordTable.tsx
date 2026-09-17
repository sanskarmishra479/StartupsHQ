"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminApi } from "@/lib/admin-api";
import type { AdminEntity, AdminListItem, RecordStatus } from "@/types/admin";
import { PillButton } from "../../ui/PillButton";
import { adminPaths, ENTITY_INFO } from "../entities";
import { Notice } from "../form";
import { StatusBadge } from "../StatusBadge";
import { formatTimestamp } from "../time";
import { displayName } from "./labels";

type BulkAction = "publish" | "unpublish" | "archive" | "restore";

const ACTIONS: Record<
  BulkAction,
  { label: string; from: readonly RecordStatus[]; done: string }
> = {
  publish: { label: "Publish", from: ["draft"], done: "published" },
  unpublish: { label: "Unpublish", from: ["published"], done: "unpublished" },
  archive: {
    label: "Archive",
    from: ["draft", "published"],
    done: "archived",
  },
  restore: { label: "Restore", from: ["archived"], done: "restored" },
};

/** Archiving is `DELETE`; the other transitions are POSTs to their own path (API §8.1). */
function request(kind: AdminEntity, id: string, action: BulkAction) {
  const path = adminPaths.api(kind, id);
  return action === "archive"
    ? adminApi("DELETE", path)
    : adminApi("POST", `${path}/${action}`);
}

type Outcome = Readonly<{
  action: BulkAction;
  succeeded: number;
  failures: readonly { name: string; message: string }[];
}>;

/**
 * A list of records with bulk publish, unpublish, archive and restore (FR-203). Each selected
 * record goes through the same endpoint a single action uses, so every change is validated and
 * audited on its own, and one failure never hides the others.
 */
export function RecordTable({
  kind,
  items,
}: Readonly<{ kind: AdminEntity; items: readonly AdminListItem[] }>) {
  const router = useRouter();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<BulkAction | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const chosen = items.filter((item) => selected.has(item.id));
  const allSelected = items.length > 0 && chosen.length === items.length;

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  async function run(action: BulkAction) {
    const targets = chosen.filter((item) =>
      ACTIONS[action].from.includes(item.status),
    );
    if (
      action === "archive" &&
      !window.confirm(
        `Archive ${targets.length} ${targets.length === 1 ? "record" : "records"}? They disappear from the public site until restored.`,
      )
    ) {
      return;
    }
    setPending(action);
    setOutcome(null);
    const failures: { name: string; message: string }[] = [];
    let succeeded = 0;
    for (const item of targets) {
      const result = await request(kind, item.id, action);
      if (result.ok) succeeded += 1;
      else {
        const missing = result.details.map((detail) => detail.path).join(", ");
        failures.push({
          name: displayName(kind, item),
          message: missing ? `${result.message} (${missing})` : result.message,
        });
      }
    }
    setPending(null);
    setOutcome({ action, succeeded, failures });
    setSelected(new Set());
    router.refresh();
  }

  if (items.length === 0) {
    return (
      <p className="rounded-md border border-border border-dashed px-4 py-10 text-center text-fg-muted text-sm">
        No {ENTITY_INFO[kind].plural.toLowerCase()} match.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        role="toolbar"
        aria-label="Bulk actions"
        className="flex min-h-9 flex-wrap items-center gap-2"
      >
        <span className="text-fg-muted text-sm">
          {chosen.length > 0
            ? `${chosen.length} selected`
            : "Select rows to publish, archive or restore"}
        </span>
        {chosen.length > 0 &&
          (Object.keys(ACTIONS) as BulkAction[]).map((action) => {
            const eligible = chosen.filter((item) =>
              ACTIONS[action].from.includes(item.status),
            ).length;
            if (eligible === 0) return null;
            return (
              <PillButton
                key={action}
                size="sm"
                variant={action === "publish" ? "solid" : "outline"}
                disabled={pending !== null}
                onClick={() => void run(action)}
              >
                {pending === action
                  ? "Working…"
                  : `${ACTIONS[action].label} ${eligible}`}
              </PillButton>
            );
          })}
      </div>

      {outcome && (
        <Notice
          tone={outcome.failures.length > 0 ? "error" : "success"}
          title={`${outcome.succeeded} ${outcome.succeeded === 1 ? "record" : "records"} ${ACTIONS[outcome.action].done}${outcome.failures.length > 0 ? `, ${outcome.failures.length} failed` : ""}.`}
        >
          {outcome.failures.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {outcome.failures.map((failure) => (
                <li key={failure.name}>
                  {failure.name}: {failure.message}
                </li>
              ))}
            </ul>
          )}
        </Notice>
      )}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="border-border border-b bg-surface">
            <tr>
              <th scope="col" className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label="Select all on this page"
                  checked={allSelected}
                  onChange={() =>
                    setSelected(
                      allSelected
                        ? new Set()
                        : new Set(items.map((item) => item.id)),
                    )
                  }
                  className="size-4 accent-fg"
                />
              </th>
              <th
                scope="col"
                className="meta px-3 py-2 font-normal text-fg-subtle"
              >
                Name
              </th>
              <th
                scope="col"
                className="meta px-3 py-2 font-normal text-fg-subtle"
              >
                Status
              </th>
              <th
                scope="col"
                className="meta px-3 py-2 font-normal text-fg-subtle"
              >
                Updated
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((item) => {
              const name = displayName(kind, item);
              return (
                <tr
                  key={item.id}
                  className={
                    selected.has(item.id) ? "bg-surface-raised" : undefined
                  }
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Select ${name}`}
                      checked={selected.has(item.id)}
                      onChange={() => toggle(item.id)}
                      className="size-4 accent-fg"
                    />
                  </td>
                  <td className="max-w-0 px-3 py-2">
                    <Link
                      href={adminPaths.edit(kind, item.id)}
                      prefetch={false}
                      className="block truncate font-medium hover:underline"
                    >
                      {name}
                    </Link>
                    {item.subtitle && (
                      <span className="block truncate text-fg-muted text-xs">
                        {item.subtitle}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <StatusBadge status={item.status} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-fg-muted text-xs">
                    {formatTimestamp(item.updatedAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
