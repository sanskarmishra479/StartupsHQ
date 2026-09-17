"use client";

import Link from "next/link";
import { type ReactNode, useState } from "react";
import { founderRoleLabel, roundTypeLabel } from "@/lib/labels";
import type { Lookups } from "@/types/admin";
import { Money } from "../../data/Money";
import { PillButton } from "../../ui/PillButton";
import { Combobox } from "../editor/Combobox";
import { FOUNDER_ROLE_OPTIONS } from "../editor/fields";
import { localLoader, recordLoader } from "../editor/pickers";
import { adminPaths } from "../entities";
import { Checkbox, Field, inputClasses, Notice, TextInput } from "../form";
import { StatusBadge } from "../StatusBadge";
import { CreateDialog, createDraft, InvestorPicker } from "./InlineCreate";
import { RoundDialog } from "./RoundDialog";
import type { StartupLinksApi } from "./useStartupLinks";

// The link sections of the startup form (FR-204): industries, founders, investors, batches and
// rounds. Each picker searches existing records, drafts included, and can create a draft inline.

function Section({
  title,
  description,
  children,
}: Readonly<{ title: string; description?: string; children: ReactNode }>) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 font-medium text-base">{title}</legend>
      {description && (
        <p className="-mt-1 text-fg-subtle text-xs">{description}</p>
      )}
      {children}
    </fieldset>
  );
}

function Rows({
  children,
  empty,
}: Readonly<{ children: ReactNode[]; empty: string }>) {
  if (children.length === 0) {
    return <p className="text-fg-subtle text-sm">{empty}</p>;
  }
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {children}
    </ul>
  );
}

function RemoveButton({
  label,
  onClick,
  disabled,
}: Readonly<{ label: string; onClick: () => void; disabled?: boolean }>) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="meta shrink-0 rounded-sm px-1.5 py-1 text-fg-muted hover:text-fg disabled:opacity-50"
    >
      Remove
    </button>
  );
}

export function IndustriesSection({
  api,
  lookups,
}: Readonly<{ api: StartupLinksApi; lookups: Lookups }>) {
  const chosen = api.links.industries;
  const available = lookups.industries
    .filter((industry) => !chosen.some((link) => link.id === industry.id))
    .map((industry) => ({ id: industry.id, label: industry.name }));
  return (
    <Section
      title="Industries"
      description="The primary industry is the one shown on cards."
    >
      {chosen.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {chosen.map((industry) => (
            <li
              key={industry.id}
              className="inline-flex h-8 items-center gap-2 rounded-pill border border-border-strong pr-1 pl-3 text-sm"
            >
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="radio"
                  name="primary-industry"
                  checked={industry.isPrimary}
                  disabled={api.pending}
                  onChange={() =>
                    void api.setIndustries(
                      chosen.map((item) => ({
                        ...item,
                        isPrimary: item.id === industry.id,
                      })),
                    )
                  }
                  className="accent-fg"
                  aria-label={`Make ${industry.name} the primary industry`}
                />
                {industry.name}
                {industry.isPrimary && (
                  <span className="meta text-fg-subtle">Primary</span>
                )}
              </label>
              <RemoveButton
                label={`Remove ${industry.name}`}
                disabled={api.pending}
                onClick={() =>
                  void api.setIndustries(
                    chosen.filter((item) => item.id !== industry.id),
                  )
                }
              />
            </li>
          ))}
        </ul>
      )}
      <Combobox
        label="Add an industry"
        placeholder="Add an industry"
        disabled={api.pending}
        load={localLoader(available)}
        onSelect={(option) =>
          void api.setIndustries([
            ...chosen,
            {
              id: option.id,
              name: option.label,
              isPrimary: chosen.length === 0,
            },
          ])
        }
      />
    </Section>
  );
}

type PendingFounder = Readonly<{
  founderId: string;
  fullName: string;
  isNew: boolean;
}>;

export function FoundersSection({ api }: Readonly<{ api: StartupLinksApi }>) {
  const [adding, setAdding] = useState<PendingFounder | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  return (
    <Section
      title="Founders and team"
      description="A source URL records where the attribution came from."
    >
      <Rows empty="No founders linked yet.">
        {api.links.founders.map((founder) => (
          <li
            key={founder.linkId}
            className="flex items-center gap-3 px-3 py-2"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm">
                {founder.fullName}{" "}
                <span className="text-fg-muted">
                  · {founderRoleLabel(founder.role)}
                </span>
              </span>
              <span className="meta text-fg-subtle">
                {founder.joinedYear ?? "?"}–
                {founder.isCurrent ? "now" : (founder.leftYear ?? "?")}
                {founder.sourceUrl ? " · sourced" : ""}
              </span>
            </span>
            {founder.status !== "published" && (
              <StatusBadge status={founder.status} />
            )}
            <RemoveButton
              label={`Remove ${founder.fullName}`}
              disabled={api.pending}
              onClick={() => void api.removeFounder(founder.linkId)}
            />
          </li>
        ))}
      </Rows>
      {createError && <Notice tone="error">{createError}</Notice>}
      {adding ? (
        <StintForm
          founder={adding}
          disabled={api.pending}
          onCancel={() => setAdding(null)}
          onAdd={async (stint) => {
            const ok = await api.addFounder({
              founderId: adding.founderId,
              fullName: adding.fullName,
              status: "draft",
              ...stint,
            });
            if (ok) setAdding(null);
          }}
        />
      ) : (
        <Combobox
          label="Add a founder"
          placeholder="Add a founder — search or create"
          debounceMs={200}
          disabled={api.pending}
          load={recordLoader("founder")}
          createLabel={(text) => `Create draft founder “${text}”`}
          onSelect={(option) =>
            setAdding({
              founderId: option.id,
              fullName: option.label,
              isNew: false,
            })
          }
          onCreate={async (text) => {
            setCreateError(null);
            const result = await createDraft("founders", { fullName: text });
            if ("error" in result) setCreateError(result.error);
            else
              setAdding({ founderId: result.id, fullName: text, isNew: true });
          }}
        />
      )}
    </Section>
  );
}

function StintForm({
  founder,
  disabled,
  onAdd,
  onCancel,
}: Readonly<{
  founder: PendingFounder;
  disabled: boolean;
  onAdd: (stint: {
    role: string;
    isCurrent: boolean;
    joinedYear: number | null;
    leftYear: number | null;
    sourceUrl: string | null;
  }) => void;
  onCancel: () => void;
}>) {
  const [role, setRole] = useState("cofounder");
  const [isCurrent, setIsCurrent] = useState(true);
  const [joined, setJoined] = useState("");
  const [left, setLeft] = useState("");
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);

  const year = (value: string) => (value.trim() === "" ? null : Number(value));

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border-strong p-3">
      <p className="text-sm">
        {founder.fullName}
        {founder.isNew && (
          <span className="meta ml-2 text-fg-subtle">New draft</span>
        )}
      </p>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Role">
          <select
            value={role}
            onChange={(event) => setRole(event.target.value)}
            className={inputClasses}
          >
            {FOUNDER_ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Joined">
          <TextInput
            inputMode="numeric"
            maxLength={4}
            value={joined}
            onChange={(event) => setJoined(event.target.value)}
          />
        </Field>
        <Field label="Left">
          <TextInput
            inputMode="numeric"
            maxLength={4}
            value={left}
            disabled={isCurrent}
            onChange={(event) => setLeft(event.target.value)}
          />
        </Field>
        <div className="flex items-end pb-2">
          <Checkbox
            label="Current"
            checked={isCurrent}
            onChange={(event) => setIsCurrent(event.target.checked)}
          />
        </div>
      </div>
      <Field
        label="Source URL"
        hint="Where this role is stated, e.g. the company's team page."
      >
        <TextInput
          type="url"
          placeholder="https://"
          value={source}
          onChange={(event) => setSource(event.target.value)}
        />
      </Field>
      {error && <p className="text-danger text-xs">{error}</p>}
      <div className="flex gap-2">
        <PillButton
          size="sm"
          disabled={disabled}
          onClick={() => {
            const joinedYear = year(joined);
            const leftYear = isCurrent ? null : year(left);
            if (
              [joinedYear, leftYear].some(
                (value) => value !== null && !(value >= 1900 && value <= 2100),
              )
            ) {
              setError("Years are four digits.");
              return;
            }
            if (source.trim() && !/^https:\/\/\S+$/.test(source.trim())) {
              setError("The source must be an https:// URL.");
              return;
            }
            onAdd({
              role,
              isCurrent,
              joinedYear,
              leftYear,
              sourceUrl: source.trim() || null,
            });
          }}
        >
          Add founder
        </PillButton>
        <PillButton size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </PillButton>
      </div>
    </div>
  );
}

export function InvestorsSection({ api }: Readonly<{ api: StartupLinksApi }>) {
  const [lead, setLead] = useState(false);
  const backers = api.links.investors.filter(
    (investor) => investor.roundId === null,
  );
  return (
    <Section
      title="Investors"
      description="Backers whose round is unknown. Round participants are added with the round."
    >
      <Rows empty="No other backers.">
        {backers.map((investor) => (
          <li
            key={investor.linkId}
            className="flex items-center gap-3 px-3 py-2"
          >
            <span className="min-w-0 flex-1 truncate text-sm">
              {investor.name}
              {investor.isLead && (
                <span className="meta ml-2 text-fg-subtle">Lead</span>
              )}
            </span>
            {investor.status !== "published" && (
              <StatusBadge status={investor.status} />
            )}
            <RemoveButton
              label={`Remove ${investor.name}`}
              disabled={api.pending}
              onClick={() => void api.removeInvestor(investor.linkId)}
            />
          </li>
        ))}
      </Rows>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <InvestorPicker
            label="Add an investor"
            disabled={api.pending}
            onPick={(option) =>
              void api.addInvestor({
                investorId: option.id,
                name: option.label,
                status: "draft",
                isLead: lead,
              })
            }
          />
        </div>
        <Checkbox
          label="Lead"
          checked={lead}
          onChange={(event) => setLead(event.target.checked)}
        />
      </div>
    </Section>
  );
}

export function BatchesSection({ api }: Readonly<{ api: StartupLinksApi }>) {
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <Section title="Accelerator batches">
      <Rows empty="Not in any batch.">
        {api.links.batches.map((batch) => (
          <li key={batch.batchId} className="flex items-center gap-3 px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-sm">
              {batch.name}
            </span>
            {batch.status !== "published" && (
              <StatusBadge status={batch.status} />
            )}
            <RemoveButton
              label={`Remove ${batch.name}`}
              disabled={api.pending}
              onClick={() => void api.removeBatch(batch.batchId)}
            />
          </li>
        ))}
      </Rows>
      <Combobox
        label="Add a batch"
        placeholder="Add a batch — search or create"
        debounceMs={200}
        disabled={api.pending}
        load={recordLoader("batch")}
        createLabel={(text) => `Create draft batch “${text}”`}
        onSelect={(option) =>
          void api.addBatch({
            batchId: option.id,
            name: option.label,
            status: "draft",
          })
        }
        onCreate={(text) => {
          setError(null);
          setCreating(text);
        }}
      />
      <CreateDialog
        open={creating !== null}
        title="New batch"
        onClose={() => setCreating(null)}
        error={error}
        pending={pending}
        onSubmit={async (form) => {
          const programName = String(form.get("programName") ?? "").trim();
          const label = String(form.get("label") ?? "").trim();
          const year = Number(form.get("year"));
          setPending(true);
          const result = await createDraft("batches", {
            programName,
            label,
            year,
          });
          setPending(false);
          if ("error" in result) {
            setError(result.error);
            return;
          }
          setCreating(null);
          void api.addBatch({
            batchId: result.id,
            name: `${programName} ${label}`,
            status: "draft",
          });
        }}
      >
        <Field label="Program" required>
          <TextInput
            name="programName"
            defaultValue={creating ?? ""}
            required
            maxLength={200}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Label" hint="e.g. W25" required>
            <TextInput name="label" required maxLength={40} />
          </Field>
          <Field label="Year" required>
            <TextInput
              name="year"
              inputMode="numeric"
              required
              pattern="\d{4}"
              maxLength={4}
              defaultValue={String(new Date().getUTCFullYear())}
            />
          </Field>
        </div>
      </CreateDialog>
    </Section>
  );
}

export function RoundsSection({
  api,
  isAdmin,
}: Readonly<{ api: StartupLinksApi; isAdmin: boolean }>) {
  const [open, setOpen] = useState(false);
  return (
    <Section
      title="Funding rounds"
      description="Every round cites its source. Amounts in other currencies are converted to US dollars on save."
    >
      <Rows empty="No rounds yet.">
        {api.links.rounds.map((round) => (
          <li key={round.id} className="flex items-center gap-3 px-3 py-2">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm">
                {roundTypeLabel(round.roundType) ?? round.roundType} ·{" "}
                {round.announcedOn}
              </span>
              <span className="meta text-fg-subtle">
                {round.isUndisclosed ? (
                  "Undisclosed"
                ) : round.amountUsd !== null ? (
                  <Money amountUsd={round.amountUsd} />
                ) : round.amountOriginal ? (
                  `${round.currency} ${round.amountOriginal}`
                ) : (
                  "—"
                )}
                {round.participants.length > 0 &&
                  ` · ${round.participants.map((participant) => participant.name + (participant.isLead ? " (lead)" : "")).join(", ")}`}
              </span>
            </span>
            {round.saved ? (
              <>
                <StatusBadge status={round.status} />
                <Link
                  href={adminPaths.edit("round", round.id)}
                  prefetch={false}
                  className="meta shrink-0 text-fg-muted hover:text-fg"
                >
                  Edit
                </Link>
              </>
            ) : (
              <RemoveButton
                label="Remove this round"
                onClick={() => api.removeUnsavedRound(round.id)}
              />
            )}
          </li>
        ))}
      </Rows>
      <div>
        <PillButton
          size="sm"
          variant="outline"
          onClick={() => setOpen(true)}
          disabled={api.pending}
        >
          Add round
        </PillButton>
      </div>
      <RoundDialog
        open={open}
        onClose={() => setOpen(false)}
        api={api}
        isAdmin={isAdmin}
      />
    </Section>
  );
}
