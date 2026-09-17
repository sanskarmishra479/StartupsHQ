"use client";

import { useId } from "react";
import { cx } from "@/lib/cx";
import type { Lookups } from "@/types/admin";
import type { Image } from "@/types/public";
import {
  Checkbox,
  controlClasses,
  Field,
  inputClasses,
  TextInput,
} from "../form";
import { Combobox } from "./Combobox";
import type { FieldSpec, FormValue, FormValues } from "./fields";
import { MediaField } from "./MediaField";
import { localLoader, recordLoader } from "./pickers";

export type FieldContext = Readonly<{
  lookups: Lookups;
  previews: Readonly<Record<string, Image>>;
  setPreview: (assetId: string, image: Image | null) => void;
  /** Display names for ids held by `record` fields. */
  names: Readonly<Record<string, string>>;
  setName: (id: string, name: string) => void;
}>;

/** One section's fields, laid out two to a row where they are short. */
export function FieldGrid({
  specs,
  values,
  errors,
  onChange,
  context,
}: Readonly<{
  specs: readonly FieldSpec[];
  values: FormValues;
  errors: Readonly<Record<string, string>>;
  onChange: (key: string, value: FormValue) => void;
  context: FieldContext;
}>) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {specs.map((spec) => (
        <div key={spec.key} className={cx(!spec.half && "md:col-span-2")}>
          <FieldControl
            spec={spec}
            value={values[spec.key] ?? null}
            error={errors[spec.key]}
            onChange={(value) => onChange(spec.key, value)}
            context={context}
          />
        </div>
      ))}
    </div>
  );
}

function FieldControl({
  spec,
  value,
  error,
  onChange,
  context,
}: Readonly<{
  spec: FieldSpec;
  value: FormValue;
  error: string | undefined;
  onChange: (value: FormValue) => void;
  context: FieldContext;
}>) {
  const text = typeof value === "string" ? value : "";
  const hintId = useId();

  switch (spec.kind) {
    case "checkbox":
      return (
        <div className="flex flex-col gap-1">
          <Checkbox
            label={spec.label}
            checked={Boolean(value)}
            onChange={(event) => onChange(event.target.checked)}
          />
          {spec.hint && <p className="text-fg-subtle text-xs">{spec.hint}</p>}
        </div>
      );
    case "textarea":
      return (
        <Field
          label={spec.label}
          hint={spec.hint}
          error={error}
          required={spec.required}
        >
          <textarea
            rows={spec.max && spec.max > 1000 ? 6 : 3}
            value={text}
            maxLength={spec.max}
            onChange={(event) => onChange(event.target.value)}
            className={cx(controlClasses, "py-2 leading-relaxed")}
          />
        </Field>
      );
    case "select":
      return (
        <Field
          label={spec.label}
          hint={spec.hint}
          error={error}
          required={spec.required}
        >
          <select
            value={text}
            onChange={(event) => onChange(event.target.value)}
            className={inputClasses}
          >
            <option value="">{spec.required ? "Choose…" : "—"}</option>
            {spec.options?.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      );
    case "media":
      return (
        <Field label={spec.label} hint={spec.hint} error={error}>
          <MediaField
            purpose={spec.purpose ?? "logo"}
            value={text}
            preview={text ? (context.previews[text] ?? null) : null}
            onChange={(assetId, image) => {
              if (assetId && image) context.setPreview(assetId, image);
              onChange(assetId);
            }}
          />
        </Field>
      );
    case "location": {
      const current = context.lookups.locations.find(
        (option) => option.id === text,
      );
      return (
        <SelectedPicker
          spec={spec}
          error={error}
          hintId={hintId}
          selected={current ? current.label : text ? "Unknown location" : null}
          onClear={() => onChange("")}
          picker={(id, describedBy) => (
            <Combobox
              id={id}
              describedBy={describedBy}
              invalid={Boolean(error)}
              placeholder="Search cities and countries"
              load={localLoader(
                context.lookups.locations.map((option) => ({
                  id: option.id,
                  label: option.label,
                })),
              )}
              onSelect={(option) => onChange(option.id)}
            />
          )}
        />
      );
    }
    case "record":
      return (
        <SelectedPicker
          spec={spec}
          error={error}
          hintId={hintId}
          selected={text ? (context.names[text] ?? "Selected record") : null}
          onClear={() => onChange("")}
          picker={(id, describedBy) => (
            <Combobox
              id={id}
              describedBy={describedBy}
              invalid={Boolean(error)}
              placeholder="Search by name"
              debounceMs={200}
              load={recordLoader(spec.entity ?? "startup")}
              onSelect={(option) => {
                context.setName(option.id, option.label);
                onChange(option.id);
              }}
            />
          )}
        />
      );
    default:
      return (
        <Field
          label={spec.label}
          hint={spec.hint}
          error={error}
          required={spec.required}
        >
          <TextInput
            type={
              spec.kind === "url"
                ? "url"
                : spec.kind === "date"
                  ? "date"
                  : "text"
            }
            inputMode={
              spec.kind === "year" || spec.kind === "usd"
                ? "numeric"
                : undefined
            }
            value={text}
            maxLength={spec.max}
            placeholder={spec.kind === "url" ? "https://" : undefined}
            onChange={(event) => onChange(event.target.value)}
          />
        </Field>
      );
  }
}

/** A picker that shows the chosen value with a way to clear it, or the search box when empty. */
function SelectedPicker({
  spec,
  error,
  hintId,
  selected,
  onClear,
  picker,
}: Readonly<{
  spec: FieldSpec;
  error: string | undefined;
  hintId: string;
  selected: string | null;
  onClear: () => void;
  picker: (id: string, describedBy: string | undefined) => React.ReactNode;
}>) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-medium text-sm">
        {spec.label}
      </label>
      {selected ? (
        <div className="flex h-9 items-center justify-between gap-2 rounded-md border border-border-strong bg-surface px-3 text-sm">
          <span className="truncate">{selected}</span>
          <button
            id={id}
            type="button"
            onClick={onClear}
            aria-label={`Clear ${spec.label}`}
            className="meta text-fg-muted hover:text-fg"
          >
            Change
          </button>
        </div>
      ) : (
        picker(id, spec.hint || error ? hintId : undefined)
      )}
      {(spec.hint || error) && (
        <p
          id={hintId}
          className={cx("text-xs", error ? "text-danger" : "text-fg-subtle")}
        >
          {error ?? spec.hint}
        </p>
      )}
    </div>
  );
}
