"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { isSlug } from "@/lib/slug";
import type { AdminEntity, AdminRecord } from "@/types/admin";
import { PillButton } from "../../ui/PillButton";
import { Dialog } from "../Dialog";
import { adminPaths, ENTITY_INFO, publicUrl } from "../entities";
import { Field, Notice, TextInput } from "../form";
import { StatusBadge } from "../StatusBadge";
import { formatTimestamp } from "../time";

type Lifecycle = "publish" | "unpublish" | "archive" | "restore";

/**
 * The record's state and what can be done to it (FR-203, FR-204, FR-209, FR-407). Save and
 * Publish are distinct: publishing first saves whatever is unsaved. Slug changes and permanent
 * deletion are offered to admins only, and the API checks the role again.
 */
export function RecordActions({
  kind,
  record,
  isAdmin,
  dirty,
  saving,
  onSave,
  displayName,
  publishLinked,
}: Readonly<{
  kind: AdminEntity;
  record: AdminRecord | null;
  isAdmin: boolean;
  dirty: boolean;
  saving: boolean;
  /**
   * Saves (creating when new) and resolves to the record id, or null when it failed. With `stay`,
   * a new record does not navigate to its page yet, because more requests follow.
   */
  onSave: (options?: { stay?: boolean }) => Promise<string | null>;
  displayName: string;
  /**
   * Startups: publishes the drafts a new page would link to (founders, investors, batches and
   * rounds created alongside it). Resolves to how many failed.
   */
  publishLinked?: (id: string) => Promise<number>;
}>) {
  const router = useRouter();
  const info = ENTITY_INFO[kind];
  const [busy, setBusy] = useState<Lifecycle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slugOpen, setSlugOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [withLinked, setWithLinked] = useState(true);

  async function transition(action: Lifecycle) {
    setError(null);
    let id = record?.id ?? null;
    if (action === "publish" && (dirty || !record)) {
      id = await onSave({ stay: true });
      if (!id) return;
    }
    if (!id) return;
    if (
      action === "archive" &&
      !window.confirm(
        `Archive this ${info.singular.toLowerCase()}? It disappears from the public site until restored.`,
      )
    ) {
      return;
    }
    setBusy(action);
    const path = adminPaths.api(kind, id);
    const result =
      action === "archive"
        ? await adminApi("DELETE", path)
        : await adminApi("POST", `${path}/${action}`);
    if (!result.ok) {
      setBusy(null);
      setError(result.message);
      if (!record) router.replace(adminPaths.edit(kind, id));
      return;
    }
    if (action === "publish" && publishLinked && withLinked) {
      const failed = await publishLinked(id);
      if (failed > 0) {
        setError(
          `Published, but ${failed} linked ${failed === 1 ? "draft" : "drafts"} could not be published. Open them to see why.`,
        );
      }
    }
    setBusy(null);
    if (!record) router.replace(adminPaths.edit(kind, id));
    else router.refresh();
  }

  const status = record?.status ?? "draft";
  const disabled = saving || busy !== null;

  return (
    <aside
      aria-label="Record"
      className="flex flex-col gap-4 rounded-md border border-border p-4 lg:sticky lg:top-6"
    >
      <div className="flex items-center justify-between gap-2">
        <StatusBadge status={status} />
        {dirty && <span className="meta text-fg-muted">Unsaved changes</span>}
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      <div className="flex flex-col gap-2">
        {status !== "archived" && (
          <PillButton
            variant={status === "published" ? "solid" : "outline"}
            disabled={disabled || (Boolean(record) && !dirty)}
            onClick={() => void onSave()}
          >
            {saving
              ? "Saving…"
              : status === "published"
                ? "Save changes"
                : "Save draft"}
          </PillButton>
        )}
        {status === "draft" && (
          <PillButton
            disabled={disabled}
            onClick={() => void transition("publish")}
          >
            {busy === "publish" || (saving && busy === null && !record)
              ? "Publishing…"
              : "Publish"}
          </PillButton>
        )}
        {status === "draft" && publishLinked && (
          <label className="flex items-center gap-2 text-fg-muted text-xs">
            <input
              type="checkbox"
              checked={withLinked}
              onChange={(event) => setWithLinked(event.target.checked)}
              className="size-3.5 accent-fg"
            />
            Also publish linked drafts
          </label>
        )}
        {status === "published" && (
          <PillButton
            variant="outline"
            disabled={disabled}
            onClick={() => void transition("unpublish")}
          >
            {busy === "unpublish" ? "Unpublishing…" : "Unpublish"}
          </PillButton>
        )}
        {status === "archived" && (
          <PillButton
            disabled={disabled}
            onClick={() => void transition("restore")}
          >
            {busy === "restore" ? "Restoring…" : "Restore as draft"}
          </PillButton>
        )}
        {record && status !== "archived" && (
          <PillButton
            variant="outline"
            disabled={disabled}
            onClick={() => void transition("archive")}
          >
            {busy === "archive" ? "Archiving…" : "Archive"}
          </PillButton>
        )}
      </div>

      {record && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {record.slug && (
            <>
              <dt className="text-fg-subtle">Slug</dt>
              <dd className="truncate font-mono">{record.slug}</dd>
            </>
          )}
          <dt className="text-fg-subtle">Updated</dt>
          <dd>{formatTimestamp(record.updatedAt)}</dd>
          <dt className="text-fg-subtle">First published</dt>
          <dd>
            {record.firstPublishedAt
              ? formatTimestamp(record.firstPublishedAt)
              : "Never"}
          </dd>
        </dl>
      )}

      {record?.slug && status === "published" && info.publicPath && (
        <a
          href={publicUrl(info.publicPath(record.slug))}
          target="_blank"
          rel="noopener"
          className="text-fg-muted text-sm underline underline-offset-2 hover:text-fg"
        >
          View on the public site
        </a>
      )}

      {record && isAdmin && (
        <div className="flex flex-col gap-2 border-border border-t pt-4">
          <p className="meta text-fg-subtle">Admin</p>
          {record.slug !== null && (
            <PillButton
              size="sm"
              variant="outline"
              onClick={() => setSlugOpen(true)}
            >
              Change slug
            </PillButton>
          )}
          {record.firstPublishedAt === null && (
            <PillButton
              size="sm"
              variant="outline"
              onClick={() => setDeleteOpen(true)}
            >
              Delete permanently
            </PillButton>
          )}
        </div>
      )}

      {record && (
        <>
          <SlugDialog
            open={slugOpen}
            onClose={() => setSlugOpen(false)}
            kind={kind}
            record={record}
            onDone={() => {
              setSlugOpen(false);
              router.refresh();
            }}
          />
          <DeleteDialog
            open={deleteOpen}
            onClose={() => setDeleteOpen(false)}
            kind={kind}
            record={record}
            displayName={displayName}
            onDone={() => router.replace(adminPaths.list(kind))}
          />
        </>
      )}
    </aside>
  );
}

function SlugDialog({
  open,
  onClose,
  kind,
  record,
  onDone,
}: Readonly<{
  open: boolean;
  onClose: () => void;
  kind: AdminEntity;
  record: AdminRecord;
  onDone: () => void;
}>) {
  const [slug, setSlug] = useState(record.slug ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={open} onClose={onClose} title="Change slug">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          const next = slug.trim();
          if (!isSlug(next)) {
            setError("Use lowercase letters, digits and single hyphens.");
            return;
          }
          setPending(true);
          const result = await adminApi(
            "POST",
            `${adminPaths.api(kind, record.id)}/slug`,
            {
              slug: next,
            },
          );
          setPending(false);
          if (!result.ok) {
            setError(
              result.status === 409
                ? "That slug is already taken."
                : result.message,
            );
            return;
          }
          onDone();
        }}
      >
        <p className="text-fg-muted text-sm">
          The old address keeps working: it redirects permanently to the new
          one.
        </p>
        <Field label="New slug" error={error ?? undefined}>
          <TextInput
            value={slug}
            onChange={(event) => {
              setSlug(event.target.value);
              setError(null);
            }}
            spellCheck={false}
            className="font-mono"
          />
        </Field>
        <div className="flex justify-end gap-2">
          <PillButton
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
          >
            Cancel
          </PillButton>
          <PillButton
            type="submit"
            size="sm"
            disabled={pending || slug.trim() === record.slug}
          >
            {pending ? "Changing…" : "Change slug"}
          </PillButton>
        </div>
      </form>
    </Dialog>
  );
}

function DeleteDialog({
  open,
  onClose,
  kind,
  record,
  displayName,
  onDone,
}: Readonly<{
  open: boolean;
  onClose: () => void;
  kind: AdminEntity;
  record: AdminRecord;
  displayName: string;
  onDone: () => void;
}>) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const confirmation = displayName.trim();
  return (
    <Dialog open={open} onClose={onClose} title="Delete permanently">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setPending(true);
          const result = await adminApi(
            "DELETE",
            `${adminPaths.api(kind, record.id)}?hard=true`,
          );
          setPending(false);
          if (!result.ok) {
            setError(result.message);
            return;
          }
          onDone();
        }}
      >
        <Notice tone="error" title="This cannot be undone">
          The record{kind === "startup" ? ", its rounds and its links" : ""}{" "}
          will be removed. Only records that were never published can be
          deleted; archive the others.
        </Notice>
        {error && <Notice tone="error">{error}</Notice>}
        <Field label={`Type “${confirmation}” to confirm`}>
          <TextInput
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <PillButton
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
          >
            Cancel
          </PillButton>
          <PillButton
            type="submit"
            size="sm"
            disabled={pending || typed.trim() !== confirmation}
          >
            {pending ? "Deleting…" : "Delete"}
          </PillButton>
        </div>
      </form>
    </Dialog>
  );
}
