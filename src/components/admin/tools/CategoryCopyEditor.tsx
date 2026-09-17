"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminApi, fieldErrors } from "@/lib/admin-api";
import { CATEGORY_TITLES, paths } from "@/lib/links";
import type { CategoryCopy } from "@/types/admin";
import type { CategoryDirectory, CategoryKind } from "@/types/public";
import { PillButton } from "../../ui/PillButton";
import { Dialog } from "../Dialog";
import { publicUrl } from "../entities";
import { Field, Notice, TextArea, TextInput } from "../form";

type Target = Readonly<{ kind: CategoryKind; slug: string; name: string }>;

const FIELDS = [
  { key: "heading", label: "Heading", max: 120 },
  {
    key: "intro",
    label: "Introduction",
    max: 4000,
    long: true,
    hint: "Plain paragraphs; blank lines separate them.",
  },
  { key: "seoTitle", label: "Search title", max: 120 },
  { key: "seoDescription", label: "Search description", max: 300, long: true },
  { key: "iconUrl", label: "Icon URL", max: 2048, hint: "https:// only." },
] as const;

/**
 * Category copy (FR-205): the heading, introduction and search snippet for values that already
 * exist. A value without copy shows generated text; clearing a field returns it to that.
 */
export function CategoryCopyEditor({
  directory,
  copy,
}: Readonly<{
  directory: CategoryDirectory;
  copy: Readonly<Record<string, CategoryCopy>>;
}>) {
  const router = useRouter();
  const [target, setTarget] = useState<Target | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const open = (next: Target) => {
    const current = copy[`${next.kind}/${next.slug}`];
    setValues(
      Object.fromEntries(
        FIELDS.map((field) => [field.key, current?.[field.key] ?? ""]),
      ),
    );
    setErrors({});
    setError(null);
    setTarget(next);
  };

  async function save() {
    if (!target) return;
    setPending(true);
    const body = Object.fromEntries(
      FIELDS.map((field) => [field.key, values[field.key]?.trim() || null]),
    );
    const result = await adminApi(
      "PATCH",
      `/api/v1/categories/${target.kind}/${target.slug}`,
      body,
    );
    setPending(false);
    if (!result.ok) {
      setErrors(fieldErrors(result.details));
      setError(result.message);
      return;
    }
    setTarget(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-8">
      {directory.map((group) => (
        <section
          key={group.kind}
          aria-labelledby={`kind-${group.kind}`}
          className="flex flex-col gap-3"
        >
          <h2 id={`kind-${group.kind}`} className="font-medium text-lg">
            {CATEGORY_TITLES[group.kind]}
          </h2>
          <ul className="divide-y divide-border rounded-md border border-border">
            {group.entries.map((entry) => {
              const hasCopy = Boolean(copy[`${group.kind}/${entry.slug}`]);
              return (
                <li
                  key={entry.slug}
                  className="flex flex-wrap items-center gap-3 px-3 py-2"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm">{entry.name}</span>
                    <span className="meta text-fg-subtle">
                      {entry.companyCount}{" "}
                      {entry.companyCount === 1 ? "company" : "companies"} ·{" "}
                      {hasCopy ? "Custom copy" : "Generated copy"}
                      {entry.isIndexable ? "" : " · not indexed"}
                    </span>
                  </span>
                  <a
                    href={publicUrl(paths.category(group.kind, entry.slug))}
                    target="_blank"
                    rel="noopener"
                    className="meta text-fg-muted hover:text-fg"
                  >
                    View
                  </a>
                  <PillButton
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      open({
                        kind: group.kind,
                        slug: entry.slug,
                        name: entry.name,
                      })
                    }
                  >
                    Edit copy
                  </PillButton>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <Dialog
        open={target !== null}
        onClose={() => setTarget(null)}
        title={target ? `Copy for ${target.name}` : ""}
      >
        <form
          noValidate
          className="flex max-h-[75dvh] flex-col gap-4 overflow-y-auto pr-1"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {error && <Notice tone="error">{error}</Notice>}
          {FIELDS.map((field) => (
            <Field
              key={field.key}
              label={field.label}
              hint={"hint" in field ? field.hint : undefined}
              error={errors[field.key]}
            >
              {"long" in field ? (
                <TextArea
                  value={values[field.key] ?? ""}
                  maxLength={field.max}
                  rows={field.key === "intro" ? 6 : 3}
                  onChange={(event) =>
                    setValues({ ...values, [field.key]: event.target.value })
                  }
                />
              ) : (
                <TextInput
                  value={values[field.key] ?? ""}
                  maxLength={field.max}
                  onChange={(event) =>
                    setValues({ ...values, [field.key]: event.target.value })
                  }
                />
              )}
            </Field>
          ))}
          <div className="flex justify-end gap-2">
            <PillButton
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setTarget(null)}
            >
              Cancel
            </PillButton>
            <PillButton type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save copy"}
            </PillButton>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
