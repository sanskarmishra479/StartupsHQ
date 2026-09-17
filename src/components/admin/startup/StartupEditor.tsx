"use client";

import Link from "next/link";
import { useState } from "react";
import { adminApi } from "@/lib/admin-api";
import type { AdminRecord } from "@/types/admin";
import {
  type EditorProps,
  nameFromValues,
  useEditor,
} from "../editor/EntityEditor";
import { FieldGrid } from "../editor/FieldGrid";
import { sectionsOf } from "../editor/fields";
import { RecordActions } from "../editor/RecordActions";
import { useUnsavedGuard } from "../editor/useEntityForm";
import { adminPaths } from "../entities";
import { Notice } from "../form";
import { PageHeader } from "../PageHeader";
import {
  BatchesSection,
  FoundersSection,
  IndustriesSection,
  InvestorsSection,
  RoundsSection,
} from "./LinkSections";
import { createBodyFromLinks, linkedDrafts, linksFromRecord } from "./links";
import { PrefillPanel } from "./PrefillPanel";
import { useStartupLinks } from "./useStartupLinks";

/**
 * The startup form (FR-204): its own fields in sections, then founders, investors, batches and
 * rounds. A new startup is created with all of its links in one request; after that, links change
 * one at a time while the fields wait for Save.
 */
export function StartupEditor(props: Omit<EditorProps, "kind">) {
  const { record, lookups, isAdmin } = props;
  const editor = useEditor({ ...props, kind: "startup" });
  const links = useStartupLinks(record);
  // A new startup's links exist only in the form until its first save.
  useUnsavedGuard(
    !record && Object.keys(createBodyFromLinks(links.links)).length > 0,
  );
  const { form } = editor;
  const [showPrefill, setShowPrefill] = useState(record === null);
  const title = nameFromValues("startup", form.values) || "New startup";
  const context = { ...editor.context, lookups };
  const sections = sectionsOf(form.specs);
  const [primary, rest] = [sections.slice(0, 4), sections.slice(4)];

  const save = (options?: { stay?: boolean }) =>
    editor.save(
      record ? {} : createBodyFromLinks(links.links),
      undefined,
      options,
    );

  /** After publishing: publish the drafts the new page links to, reading the saved links fresh. */
  async function publishLinkedDrafts(id: string): Promise<number> {
    const current = await adminApi<AdminRecord>(
      "GET",
      adminPaths.api("startup", id),
    );
    if (!current.ok) return 0;
    let failed = 0;
    for (const draft of linkedDrafts(linksFromRecord(current.data.links))) {
      const result = await adminApi(
        "POST",
        `${adminPaths.api(draft.entity, draft.id)}/publish`,
      );
      if (!result.ok) failed += 1;
    }
    return failed;
  }

  const fieldSection = (section: string) => (
    <fieldset key={section} className="flex flex-col gap-4">
      <legend className="mb-3 font-medium text-base">{section}</legend>
      <FieldGrid
        specs={form.specs.filter((spec) => spec.section === section)}
        values={form.values}
        errors={form.errors}
        onChange={form.setField}
        context={context}
      />
    </fieldset>
  );

  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            href={adminPaths.list("startup")}
            prefetch={false}
            className="hover:text-fg"
          >
            Startups
          </Link>
        }
        title={title}
        actions={
          record && !showPrefill ? (
            <button
              type="button"
              onClick={() => setShowPrefill(true)}
              className="text-fg-muted text-sm hover:text-fg"
            >
              Prefill from website
            </button>
          ) : undefined
        }
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="flex min-w-0 flex-col gap-8">
          {showPrefill && (
            <PrefillPanel
              values={form.values}
              lookups={lookups}
              onApply={(changes, images) => {
                for (const [assetId, image] of Object.entries(images)) {
                  context.setPreview(assetId, image);
                }
                for (const [key, value] of Object.entries(changes)) {
                  form.setField(key, value);
                }
              }}
            />
          )}
          {editor.error && <Notice tone="error">{editor.error}</Notice>}
          <form
            noValidate
            className="flex flex-col gap-8"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            {primary.map(fieldSection)}
          </form>

          <IndustriesSection api={links} lookups={lookups} />
          <FoundersSection api={links} />
          <InvestorsSection api={links} />
          <BatchesSection api={links} />
          <RoundsSection api={links} isAdmin={isAdmin} />
          {links.error && <Notice tone="error">{links.error}</Notice>}

          <form
            noValidate
            className="flex flex-col gap-8"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            {rest.map(fieldSection)}
          </form>
        </div>
        <RecordActions
          kind="startup"
          record={record}
          isAdmin={isAdmin}
          dirty={
            form.dirty ||
            (!record &&
              Object.keys(createBodyFromLinks(links.links)).length > 0)
          }
          saving={editor.saving}
          onSave={save}
          displayName={title}
          publishLinked={publishLinkedDrafts}
        />
      </div>
    </>
  );
}
