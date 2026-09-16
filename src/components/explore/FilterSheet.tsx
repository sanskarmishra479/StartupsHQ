"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ExploreQuery } from "@/lib/explore-query";
import { STAGE_LABELS, slugToEnum, WORK_TYPE_LABELS } from "@/lib/labels";
import type {
  CategoryDirectory,
  CategoryEntry,
  CategoryKind,
  Stage,
  WorkType,
} from "@/types/public";
import { PillButton } from "../ui/PillButton";

type FilterSheetProps = Readonly<{
  open: boolean;
  onClose: () => void;
  query: ExploreQuery;
  directory: CategoryDirectory;
  onApply: (query: ExploreQuery) => void;
}>;

const STAGES = Object.keys(STAGE_LABELS) as Stage[];
const WORK_TYPES = Object.keys(WORK_TYPE_LABELS) as WorkType[];

const entriesOf = (directory: CategoryDirectory, kind: CategoryKind) =>
  directory.find((group) => group.kind === kind)?.entries ?? [];

const toggle = <T extends string>(values: readonly T[], value: T): T[] =>
  values.includes(value)
    ? values.filter((v) => v !== value)
    : [...values, value];

/**
 * The facets (FR-101) in a native modal dialog: a bottom sheet on phones, a side panel on larger
 * screens. The browser supplies the focus trap, Escape and the inert page behind it. Choices are a
 * draft until "Show results", so the grid does not reload on every tick.
 */
export function FilterSheet({
  open,
  onClose,
  query,
  directory,
  onApply,
}: FilterSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(query);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setDraft(query);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, query]);

  // Offer only values that have companies, in the directory's order.
  const stageOptions = entriesOf(directory, "stages").flatMap((entry) => {
    const value = slugToEnum(entry.slug, STAGES);
    return value ? [{ value, entry }] : [];
  });
  const workTypeOptions = entriesOf(directory, "work-type").flatMap((entry) => {
    const value = slugToEnum(entry.slug, WORK_TYPES);
    return value ? [{ value, entry }] : [];
  });

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: a backdrop click is a mouse shortcut; keyboards close with Escape, which the dialog handles natively.
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === dialogRef.current) onClose();
      }}
      className="m-0 mt-auto max-h-[85dvh] w-full max-w-none rounded-t-xl border border-border bg-bg p-0 text-fg backdrop:bg-[rgb(0_0_0/0.6)] sm:mt-0 sm:mr-0 sm:ml-auto sm:h-dvh sm:max-h-dvh sm:w-[24rem] sm:rounded-none sm:border-y-0 sm:border-r-0"
    >
      <form
        method="dialog"
        className="flex h-full max-h-[inherit] flex-col"
        onSubmit={() => onApply(draft)}
      >
        <div className="flex items-center justify-between border-border border-b px-5 py-4">
          <h2 id={titleId} className="font-medium text-lg">
            Filters
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="meta rounded-pill px-2 py-1 text-fg-muted hover:text-fg"
          >
            Close
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-5 py-5">
          <Group legend="Stage">
            {stageOptions.map(({ value, entry }) => (
              <Check
                key={value}
                label={entry.name}
                count={entry.companyCount}
                checked={draft.stage.includes(value)}
                onChange={() =>
                  setDraft({ ...draft, stage: toggle(draft.stage, value) })
                }
              />
            ))}
          </Group>

          <Group legend="Industry" scroll>
            {entriesOf(directory, "industries").map((entry) => (
              <Check
                key={entry.slug}
                label={entry.name}
                count={entry.companyCount}
                checked={draft.industry.includes(entry.slug)}
                onChange={() =>
                  setDraft({
                    ...draft,
                    industry: toggle(draft.industry, entry.slug),
                  })
                }
              />
            ))}
          </Group>

          <Group legend="Work type">
            {workTypeOptions.map(({ value, entry }) => (
              <Check
                key={value}
                label={entry.name}
                count={entry.companyCount}
                checked={draft.workType.includes(value)}
                onChange={() =>
                  setDraft({
                    ...draft,
                    workType: toggle(draft.workType, value),
                  })
                }
              />
            ))}
          </Group>

          <Group legend="City" scroll>
            {entriesOf(directory, "cities").map((entry) => (
              <Check
                key={entry.slug}
                label={entry.name}
                count={entry.companyCount}
                checked={draft.city.includes(entry.slug)}
                onChange={() =>
                  setDraft({ ...draft, city: toggle(draft.city, entry.slug) })
                }
              />
            ))}
          </Group>

          <CountryGroup
            entries={entriesOf(directory, "countries")}
            value={draft.country}
            onChange={(country) => setDraft({ ...draft, country })}
          />

          <Group legend="Acquired companies">
            <Check
              label="Include acquired companies"
              checked={draft.includeAcquired}
              onChange={() =>
                setDraft({ ...draft, includeAcquired: !draft.includeAcquired })
              }
            />
          </Group>
        </div>

        <div className="flex items-center justify-between gap-3 border-border border-t px-5 py-4">
          <PillButton
            variant="outline"
            onClick={() =>
              setDraft({
                ...draft,
                stage: [],
                industry: [],
                workType: [],
                city: [],
                country: null,
                includeAcquired: false,
              })
            }
          >
            Clear
          </PillButton>
          <PillButton type="submit">Show results</PillButton>
        </div>
      </form>
    </dialog>
  );
}

/** "Seed, 6 companies": the visible count is aria-hidden, so the input carries the full name. */
const namedWithCount = (label: string, count: number | undefined) =>
  count === undefined
    ? undefined
    : `${label}, ${count} ${count === 1 ? "company" : "companies"}`;

function Group({
  legend,
  scroll = false,
  children,
}: Readonly<{ legend: string; scroll?: boolean; children: React.ReactNode }>) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="meta mb-2 text-fg-subtle">{legend}</legend>
      <div
        className={
          scroll
            ? "-mx-1 flex max-h-56 flex-col overflow-y-auto px-1"
            : "flex flex-col"
        }
      >
        {children}
      </div>
    </fieldset>
  );
}

function Check({
  label,
  count,
  checked,
  onChange,
}: Readonly<{
  label: string;
  count?: number;
  checked: boolean;
  onChange: () => void;
}>) {
  return (
    <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-sm px-1 text-sm hover:bg-surface-hover">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-label={namedWithCount(label, count)}
        className="size-4 accent-(--fg)"
      />
      <span className="flex-1">{label}</span>
      {count !== undefined && (
        <span aria-hidden="true" className="meta text-fg-subtle tabular-nums">
          {count}
        </span>
      )}
    </label>
  );
}

function CountryGroup({
  entries,
  value,
  onChange,
}: Readonly<{
  entries: readonly CategoryEntry[];
  value: string | null;
  onChange: (country: string | null) => void;
}>) {
  const name = useId();
  if (entries.length === 0) return null;
  const option = (code: string | null, label: string, count?: number) => (
    <label
      key={code ?? "any"}
      className="flex min-h-10 cursor-pointer items-center gap-3 rounded-sm px-1 text-sm hover:bg-surface-hover"
    >
      <input
        type="radio"
        name={name}
        checked={value === code}
        onChange={() => onChange(code)}
        aria-label={namedWithCount(label, count)}
        className="size-4 accent-(--fg)"
      />
      <span className="flex-1">{label}</span>
      {count !== undefined && (
        <span aria-hidden="true" className="meta text-fg-subtle tabular-nums">
          {count}
        </span>
      )}
    </label>
  );
  return (
    <Group legend="Country" scroll>
      {option(null, "Any country")}
      {entries.flatMap((entry) =>
        entry.countryCode
          ? [option(entry.countryCode, entry.name, entry.companyCount)]
          : [],
      )}
    </Group>
  );
}
