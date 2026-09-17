"use client";

import { type ReactNode, useRef, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { PillButton } from "../../ui/PillButton";
import { Dialog } from "../Dialog";
import { Combobox, type ComboOption } from "../editor/Combobox";
import { INVESTOR_TYPE_OPTIONS } from "../editor/fields";
import { recordLoader } from "../editor/pickers";
import { Field, inputClasses, Notice, TextInput } from "../form";

// Creating a linked record without leaving the startup form (FR-204): a founder needs only a
// name; an investor its type; a batch its program, label and year. Each is created as a draft.

/** POSTs a minimal draft and returns its id, or an error message. */
export async function createDraft(
  segment: "founders" | "investors" | "batches",
  body: Record<string, unknown>,
): Promise<{ id: string } | { error: string }> {
  const result = await adminApi<{ id: string }>(
    "POST",
    `/api/v1/${segment}`,
    body,
  );
  if (result.ok) return { id: result.data.id };
  const detail = result.details
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join(" ");
  return { error: detail || result.message };
}

/**
 * Creating an investor or batch inline needs a field or two more than a name. Not a <form>: this
 * can open from inside another dialog's form, and forms cannot nest. Enter in a field submits.
 */
export function CreateDialog({
  open,
  title,
  onClose,
  children,
  onSubmit,
  error,
  pending,
}: Readonly<{
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  onSubmit: (form: FormData) => void;
  error: string | null;
  pending: boolean;
}>) {
  const fields = useRef<HTMLDivElement>(null);
  const submit = () => {
    const container = fields.current;
    if (!container) return;
    const form = new FormData();
    for (const input of container.querySelectorAll<
      HTMLInputElement | HTMLSelectElement
    >("input[name], select[name]")) {
      if (!input.checkValidity()) {
        input.reportValidity();
        return;
      }
      form.set(input.name, input.value);
    }
    onSubmit(form);
  };
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Enter submits, as it would in a form. */}
      <div
        ref={fields}
        className="flex flex-col gap-4"
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            event.target instanceof HTMLInputElement
          ) {
            event.preventDefault();
            event.stopPropagation();
            submit();
          }
        }}
      >
        <p className="text-fg-muted text-sm">
          It is created as a draft; finish it from its own page later.
        </p>
        {error && <Notice tone="error">{error}</Notice>}
        {children}
        <div className="flex justify-end gap-2">
          <PillButton
            type="button"
            size="sm"
            variant="outline"
            onClick={onClose}
          >
            Cancel
          </PillButton>
          <PillButton
            type="button"
            size="sm"
            disabled={pending}
            onClick={submit}
          >
            {pending ? "Creating…" : "Create draft"}
          </PillButton>
        </div>
      </div>
    </Dialog>
  );
}

/** Investor picker with inline creation, shared by the backers list and round participants. */
export function InvestorPicker({
  label,
  disabled,
  onPick,
}: Readonly<{
  label: string;
  disabled?: boolean;
  onPick: (option: ComboOption) => void;
}>) {
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <>
      <Combobox
        label={label}
        placeholder={`${label} — search or create`}
        debounceMs={200}
        disabled={disabled}
        load={recordLoader("investor")}
        createLabel={(text) => `Create draft investor “${text}”`}
        onSelect={onPick}
        onCreate={(text) => {
          setError(null);
          setCreating(text);
        }}
      />
      <CreateDialog
        open={creating !== null}
        title="New investor"
        onClose={() => setCreating(null)}
        error={error}
        pending={pending}
        onSubmit={async (form) => {
          const name = String(form.get("name") ?? "").trim();
          setPending(true);
          const result = await createDraft("investors", {
            name,
            investorType: String(form.get("investorType") ?? "vc"),
          });
          setPending(false);
          if ("error" in result) {
            setError(result.error);
            return;
          }
          setCreating(null);
          onPick({ id: result.id, label: name });
        }}
      >
        <Field label="Name" required>
          <TextInput
            name="name"
            defaultValue={creating ?? ""}
            required
            maxLength={200}
          />
        </Field>
        <Field label="Type" required>
          <select
            name="investorType"
            defaultValue="vc"
            className={inputClasses}
          >
            {INVESTOR_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </CreateDialog>
    </>
  );
}
