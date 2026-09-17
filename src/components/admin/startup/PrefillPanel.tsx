"use client";

import { useState } from "react";
import { adminApi } from "@/lib/admin-api";
import type { Lookups, PrefillDraft } from "@/types/admin";
import type { Image } from "@/types/public";
import { ResponsiveImage } from "../../media/ResponsiveImage";
import { PillButton } from "../../ui/PillButton";
import type { FormValue, FormValues } from "../editor/fields";
import { Field, Notice, TextInput } from "../form";

type Proposal = Readonly<{
  key: string;
  label: string;
  value: string;
  display?: string;
  image?: Image;
  confidence?: string;
}>;

function proposals(draft: PrefillDraft, lookups: Lookups): Proposal[] {
  const list: Proposal[] = [];
  const add = (
    proposal: Omit<Proposal, "value"> & { value: string | null },
  ) => {
    if (proposal.value) list.push(proposal as Proposal);
  };
  add({
    key: "name",
    label: "Name",
    value: draft.name,
    confidence: draft.confidence.name,
  });
  add({
    key: "tagline",
    label: "Tagline",
    value: draft.tagline?.slice(0, 120) ?? null,
    confidence: draft.confidence.tagline,
  });
  add({
    key: "description",
    label: "Description",
    value: draft.description,
    confidence: draft.confidence.description,
  });
  add({ key: "websiteUrl", label: "Website", value: draft.websiteUrl });
  add({ key: "careersUrl", label: "Careers page", value: draft.careersUrl });
  add({ key: "linkedinUrl", label: "LinkedIn", value: draft.links.linkedin });
  add({ key: "xUrl", label: "X", value: draft.links.x });
  add({ key: "githubUrl", label: "GitHub", value: draft.links.github });
  if (draft.logo) {
    list.push({
      key: "logoAssetId",
      label: "Logo",
      value: draft.logo.assetId,
      image: draft.logo.image,
    });
  }
  if (draft.cover) {
    list.push({
      key: "coverAssetId",
      label: "Cover",
      value: draft.cover.assetId,
      image: draft.cover.image,
    });
  }
  const locationId = draft.locationGuess?.matchedLocationId;
  if (locationId) {
    list.push({
      key: "locationId",
      label: "Headquarters",
      value: locationId,
      display:
        lookups.locations.find((option) => option.id === locationId)?.label ??
        draft.locationGuess?.raw,
    });
  }
  return list;
}

/**
 * Prefill from a company's website (FR-401): the server fetches the page safely, and each field it
 * finds is offered separately. Fields already filled start unticked, so nothing typed is lost.
 */
export function PrefillPanel({
  values,
  lookups,
  onApply,
}: Readonly<{
  values: FormValues;
  lookups: Lookups;
  onApply: (
    changes: Record<string, FormValue>,
    images: Record<string, Image>,
  ) => void;
}>) {
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<PrefillDraft | null>(null);
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set());

  async function fetchDraft() {
    const target = url.trim();
    if (!/^https:\/\/\S+$/.test(target)) {
      setError("Enter the company's https:// address.");
      return;
    }
    setPending(true);
    setError(null);
    setDraft(null);
    const result = await adminApi<PrefillDraft>("POST", "/api/v1/prefill", {
      url: target,
    });
    setPending(false);
    if (!result.ok) {
      setError(
        result.code === "UNSAFE_URL"
          ? `That address cannot be fetched: ${result.message}`
          : result.status === 429
            ? "Prefill is limited to 20 pages an hour. Try again later or fill the form by hand."
            : result.message,
      );
      return;
    }
    setDraft(result.data);
    setAccepted(
      new Set(
        proposals(result.data, lookups)
          .filter((proposal) => !values[proposal.key])
          .map((proposal) => proposal.key),
      ),
    );
  }

  const list = draft ? proposals(draft, lookups) : [];

  return (
    <section
      aria-labelledby="prefill"
      className="flex flex-col gap-3 rounded-md border border-border p-4"
    >
      <h2 id="prefill" className="font-medium text-base">
        Prefill from website
      </h2>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field label="Company website" className="flex-1">
          <TextInput
            type="url"
            placeholder="https://"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void fetchDraft();
              }
            }}
          />
        </Field>
        <PillButton
          size="sm"
          variant="outline"
          className="h-9"
          disabled={pending}
          onClick={() => void fetchDraft()}
        >
          {pending ? "Fetching…" : "Fetch"}
        </PillButton>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {draft && (
        <div className="flex flex-col gap-3">
          {draft.warnings.length > 0 && (
            <Notice title="Warnings">
              <ul className="list-disc pl-5">
                {draft.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </Notice>
          )}
          {list.length === 0 ? (
            <p className="text-fg-muted text-sm">
              Nothing usable was found on that page.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {list.map((proposal) => (
                <li
                  key={proposal.key}
                  className="flex items-start gap-3 px-3 py-2"
                >
                  <input
                    type="checkbox"
                    id={`prefill-${proposal.key}`}
                    checked={accepted.has(proposal.key)}
                    onChange={() => {
                      const next = new Set(accepted);
                      if (next.has(proposal.key)) next.delete(proposal.key);
                      else next.add(proposal.key);
                      setAccepted(next);
                    }}
                    className="mt-1 size-4 accent-fg"
                  />
                  <label
                    htmlFor={`prefill-${proposal.key}`}
                    className="flex min-w-0 flex-1 flex-col gap-1"
                  >
                    <span className="meta text-fg-subtle">
                      {proposal.label}
                      {proposal.confidence &&
                        ` · ${proposal.confidence} confidence`}
                      {values[proposal.key] ? " · replaces current value" : ""}
                    </span>
                    {proposal.image ? (
                      <ResponsiveImage
                        image={proposal.image}
                        alt=""
                        sizes="120px"
                        fit="contain"
                        className="h-12 w-auto max-w-40 rounded-sm border border-border bg-placeholder"
                      />
                    ) : (
                      <span className="line-clamp-3 text-sm">
                        {proposal.display ?? proposal.value}
                      </span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
          )}
          {list.length > 0 && (
            <div>
              <PillButton
                size="sm"
                disabled={accepted.size === 0}
                onClick={() => {
                  const changes: Record<string, FormValue> = {};
                  const images: Record<string, Image> = {};
                  for (const proposal of list) {
                    if (!accepted.has(proposal.key)) continue;
                    changes[proposal.key] = proposal.value;
                    if (proposal.image) images[proposal.value] = proposal.image;
                  }
                  onApply(changes, images);
                  setDraft(null);
                }}
              >
                Apply {accepted.size} {accepted.size === 1 ? "field" : "fields"}
              </PillButton>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
