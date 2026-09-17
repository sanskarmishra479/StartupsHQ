"use client";

import { useState } from "react";
import { fieldErrors } from "@/lib/admin-api";
import { PillButton } from "../../ui/PillButton";
import { Dialog } from "../Dialog";
import { type FieldContext, FieldGrid } from "../editor/FieldGrid";
import { needsManualFx } from "../editor/FxDialog";
import {
  FIELD_SPECS,
  type FormValues,
  fromFormValues,
  toFormValues,
} from "../editor/fields";
import { Checkbox, Field, Notice, TextInput } from "../form";
import { InvestorPicker } from "./InlineCreate";
import type { RoundParticipant } from "./links";
import type { StartupLinksApi } from "./useStartupLinks";

const SPECS = FIELD_SPECS.round;

const NO_CONTEXT: FieldContext = {
  lookups: { industries: [], locations: [] },
  previews: {},
  setPreview: () => {},
  names: {},
  setName: () => {},
};

const fresh = (): FormValues => ({
  ...toFormValues(SPECS, {}),
  currency: "USD",
  announcedOn: new Date().toISOString().slice(0, 10),
});

/**
 * A new round with its participants (FR-106, FR-406). The server converts the amount to US dollars
 * with the ECB rate for the announcement date; when there is none, only an admin can supply a rate,
 * with its source.
 */
export function RoundDialog({
  open,
  onClose,
  api,
  isAdmin,
}: Readonly<{
  open: boolean;
  onClose: () => void;
  api: StartupLinksApi;
  isAdmin: boolean;
}>) {
  const [values, setValues] = useState<FormValues>(fresh);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [participants, setParticipants] = useState<readonly RoundParticipant[]>(
    [],
  );
  const [lead, setLead] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fxRate, setFxRate] = useState("");
  const [fxSource, setFxSource] = useState("");
  const [showFx, setShowFx] = useState(false);
  const [pending, setPending] = useState(false);

  const currency =
    typeof values.currency === "string" ? values.currency : "USD";
  const undisclosed = values.isUndisclosed === true;
  const visibleSpecs = SPECS.filter(
    (spec) =>
      !(
        undisclosed &&
        (spec.key === "amountOriginal" || spec.key === "currency")
      ),
  );

  const reset = () => {
    setValues(fresh());
    setErrors({});
    setParticipants([]);
    setError(null);
    setFxRate("");
    setFxSource("");
    setShowFx(false);
  };

  async function submit() {
    setError(null);
    const parsed = fromFormValues(visibleSpecs, values);
    const nextErrors = { ...parsed.errors };
    if (!undisclosed && !parsed.body.amountOriginal) {
      nextErrors.amountOriginal = "Enter the amount, or mark it undisclosed.";
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    const body: Record<string, unknown> = Object.fromEntries(
      Object.entries(parsed.body).filter(([, value]) => value !== null),
    );
    if (undisclosed) {
      delete body.amountOriginal;
      delete body.currency;
    }
    if (showFx && fxRate.trim()) {
      body.manualFx = { rate: fxRate.trim(), sourceNote: fxSource.trim() };
    }

    setPending(true);
    const result = await api.addRound({
      status: "draft",
      roundType: String(body.roundType),
      announcedOn: String(body.announcedOn),
      isUndisclosed: undisclosed,
      currency: undisclosed ? "USD" : currency,
      amountOriginal:
        typeof body.amountOriginal === "string" ? body.amountOriginal : null,
      amountUsd: null,
      sourceUrl: String(body.sourceUrl),
      body,
      participants,
    });
    setPending(false);
    if (!result.ok) {
      setErrors(fieldErrors(result.details));
      if (needsManualFx(result.message) && isAdmin) setShowFx(true);
      setError(result.message);
      return;
    }
    reset();
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Add a round"
    >
      <form
        noValidate
        className="flex max-h-[75dvh] flex-col gap-4 overflow-y-auto pr-1"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {error && <Notice tone="error">{error}</Notice>}
        <FieldGrid
          specs={visibleSpecs}
          values={values}
          errors={errors}
          onChange={(key, value) => {
            setValues((current) => ({ ...current, [key]: value }));
            setErrors(({ [key]: _gone, ...rest }) => rest);
          }}
          context={NO_CONTEXT}
        />

        {isAdmin && !undisclosed && currency !== "USD" && (
          <div className="flex flex-col gap-3 rounded-md border border-border p-3">
            <Checkbox
              label="Enter a manual exchange rate"
              checked={showFx}
              onChange={(event) => setShowFx(event.target.checked)}
            />
            {showFx && (
              <>
                <p className="text-fg-subtle text-xs">
                  Only when the ECB has no {currency} rate within 7 days before
                  the announcement.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={`USD per 1 ${currency}`}>
                    <TextInput
                      inputMode="decimal"
                      value={fxRate}
                      onChange={(event) => setFxRate(event.target.value)}
                      className="font-mono"
                    />
                  </Field>
                  <Field label="Rate source">
                    <TextInput
                      value={fxSource}
                      maxLength={500}
                      onChange={(event) => setFxSource(event.target.value)}
                    />
                  </Field>
                </div>
              </>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <p className="font-medium text-sm">Participants</p>
          {participants.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {participants.map((participant) => (
                <li
                  key={participant.investorId}
                  className="inline-flex h-8 items-center gap-2 rounded-pill border border-border-strong pr-1 pl-3 text-sm"
                >
                  {participant.name}
                  {participant.isLead && (
                    <span className="meta text-fg-subtle">Lead</span>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove ${participant.name}`}
                    onClick={() =>
                      setParticipants((current) =>
                        current.filter(
                          (item) => item.investorId !== participant.investorId,
                        ),
                      )
                    }
                    className="meta px-1.5 text-fg-muted hover:text-fg"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <InvestorPicker
                label="Add a participant"
                onPick={(option) => {
                  setParticipants((current) =>
                    current.some((item) => item.investorId === option.id)
                      ? current
                      : [
                          ...current,
                          {
                            investorId: option.id,
                            name: option.label,
                            isLead: lead,
                          },
                        ],
                  );
                  setLead(false);
                }}
              />
            </div>
            <Checkbox
              label="Lead"
              checked={lead}
              onChange={(event) => setLead(event.target.checked)}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <PillButton
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </PillButton>
          <PillButton type="submit" size="sm" disabled={pending}>
            {pending ? "Adding…" : "Add round"}
          </PillButton>
        </div>
      </form>
    </Dialog>
  );
}
