"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import type { AdminEntity, AdminRecord, Lookups } from "@/types/admin";
import type { Image } from "@/types/public";
import { adminPaths, ENTITY_INFO } from "../entities";
import { Notice } from "../form";
import { PageHeader } from "../PageHeader";
import { displayName as listName } from "../records/labels";
import { type FieldContext, FieldGrid } from "./FieldGrid";
import { FxDialog, type ManualFx, needsManualFx } from "./FxDialog";
import { sectionsOf } from "./fields";
import { RecordActions } from "./RecordActions";
import { useEntityForm, useUnsavedGuard } from "./useEntityForm";

export type EditorProps = Readonly<{
  kind: AdminEntity;
  record: AdminRecord | null;
  lookups: Lookups;
  previews: Readonly<Record<string, Image>>;
  names: Readonly<Record<string, string>>;
  isAdmin: boolean;
}>;

/** A record's name as the form currently has it. */
export function nameFromValues(
  kind: AdminEntity,
  values: Record<string, unknown>,
) {
  const text = (key: string) =>
    typeof values[key] === "string" ? String(values[key]) : "";
  switch (kind) {
    case "founder":
      return text("fullName");
    case "batch":
      return [text("programName"), text("label")].filter(Boolean).join(" ");
    case "round":
      return listName("round", {
        name: [text("roundType"), text("announcedOn")]
          .filter(Boolean)
          .join(" · "),
      });
    default:
      return text("name");
  }
}

/** Shared editing machinery: form state, saving and field context. */
export function useEditor({ kind, record, previews, names }: EditorProps) {
  const router = useRouter();
  const form = useEntityForm(kind, record);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewMap, setPreviewMap] = useState(previews);
  const [nameMap, setNameMap] = useState(names);
  const [fxOpen, setFxOpen] = useState(false);
  useUnsavedGuard(form.dirty);

  const context: FieldContext = {
    lookups: { industries: [], locations: [] },
    previews: previewMap,
    setPreview: (id, image) => {
      if (image) setPreviewMap((current) => ({ ...current, [id]: image }));
    },
    names: nameMap,
    setName: (id, name) =>
      setNameMap((current) => ({ ...current, [id]: name })),
  };

  /**
   * Creates or updates. `extra` joins the body (a new startup's links); `manualFx` retries a round
   * with an admin's rate. Resolves to the id, or null after showing what went wrong.
   */
  async function save(
    extra: Record<string, unknown> = {},
    manualFx?: ManualFx,
    options: { stay?: boolean } = {},
  ): Promise<string | null> {
    setError(null);
    const prepared = form.prepare();
    if (!prepared.ok) {
      setError("Fix the highlighted fields.");
      return null;
    }
    const body = {
      ...prepared.body,
      ...extra,
      ...(manualFx ? { manualFx } : {}),
    };
    if (record && Object.keys(body).length === 0) return record.id;
    setSaving(true);
    const result = record
      ? await adminApi<{ id: string }>(
          "PATCH",
          adminPaths.api(kind, record.id),
          body,
        )
      : await adminApi<{ id: string }>("POST", adminPaths.api(kind), body);
    setSaving(false);
    if (!result.ok) {
      const onFields = form.applyFailure(result);
      if (kind === "round" && needsManualFx(result.message)) {
        setError(result.message);
        return null;
      }
      setError(onFields ? "Fix the highlighted fields." : result.message);
      return null;
    }
    form.markSaved();
    setFxOpen(false);
    if (!record) {
      if (!options.stay) router.replace(adminPaths.edit(kind, result.data.id));
    } else if (!options.stay) router.refresh();
    return result.data.id;
  }

  return { form, saving, error, setError, save, context, fxOpen, setFxOpen };
}

/** The editor for founders, investors, batches and rounds (FR-203, FR-204). */
export function EntityEditor(
  props: EditorProps &
    Readonly<{ aside?: ReactNode; below?: ReactNode; eyebrow?: ReactNode }>,
) {
  const { kind, record, lookups, isAdmin } = props;
  const editor = useEditor(props);
  const { form } = editor;
  const info = ENTITY_INFO[kind];
  const title =
    nameFromValues(kind, form.values) || `New ${info.singular.toLowerCase()}`;
  const context = { ...editor.context, lookups };
  const currency =
    typeof form.values.currency === "string" ? form.values.currency : "";
  const canManualFx =
    kind === "round" &&
    isAdmin &&
    editor.error !== null &&
    needsManualFx(editor.error);

  return (
    <>
      <PageHeader
        eyebrow={
          props.eyebrow ?? (
            <Link
              href={adminPaths.list(kind)}
              prefetch={false}
              className="hover:text-fg"
            >
              {info.plural}
            </Link>
          )
        }
        title={title}
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <form
          noValidate
          className="flex min-w-0 flex-col gap-8"
          onSubmit={(event) => {
            event.preventDefault();
            void editor.save();
          }}
        >
          {editor.error && (
            <Notice tone="error">
              {editor.error}
              {canManualFx && (
                <>
                  {" "}
                  <button
                    type="button"
                    className="text-fg underline underline-offset-2"
                    onClick={() => editor.setFxOpen(true)}
                  >
                    Enter a manual rate
                  </button>
                </>
              )}
            </Notice>
          )}
          {sectionsOf(form.specs).map((section) => (
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
          ))}
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
          {props.below}
        </form>
        <div className="flex flex-col gap-4 lg:sticky lg:top-6">
          <RecordActions
            kind={kind}
            record={record}
            isAdmin={isAdmin}
            dirty={form.dirty}
            saving={editor.saving}
            onSave={(options) => editor.save({}, undefined, options)}
            displayName={title}
          />
          {props.aside}
        </div>
      </div>
      {kind === "round" && (
        <FxDialog
          open={editor.fxOpen}
          currency={currency}
          onClose={() => editor.setFxOpen(false)}
          onSubmit={(fx) => void editor.save({}, fx)}
        />
      )}
    </>
  );
}
