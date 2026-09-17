"use client";

import { useState } from "react";
import { PillButton } from "../../ui/PillButton";
import { Dialog } from "../Dialog";
import { Field, TextInput } from "../form";

export type ManualFx = Readonly<{ rate: string; sourceNote: string }>;

/** The ECB publishes no rate for this currency and date: an admin records one with its source (FR-406). */
export const needsManualFx = (message: string) =>
  /no [A-Z]{3} exchange rate/.test(message);

export function FxDialog({
  open,
  currency,
  onClose,
  onSubmit,
}: Readonly<{
  open: boolean;
  currency: string;
  onClose: () => void;
  onSubmit: (fx: ManualFx) => void;
}>) {
  const [rate, setRate] = useState("");
  const [sourceNote, setSourceNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={open} onClose={onClose} title={`Manual ${currency} rate`}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (
            !/^\d{1,10}(\.\d{1,8})?$/.test(rate.trim()) ||
            Number(rate) <= 0
          ) {
            setError("A positive decimal with at most 8 places.");
            return;
          }
          onSubmit({ rate: rate.trim(), sourceNote: sourceNote.trim() });
        }}
      >
        <p className="text-fg-muted text-sm">
          The ECB has no {currency} rate near this date. Enter US dollars per
          one {currency}, and where the rate came from; the note is kept in the
          round's notes.
        </p>
        <Field
          label={`USD per 1 ${currency}`}
          error={error ?? undefined}
          required
        >
          <TextInput
            value={rate}
            inputMode="decimal"
            onChange={(event) => {
              setRate(event.target.value);
              setError(null);
            }}
            className="font-mono"
          />
        </Field>
        <Field
          label="Source"
          hint="e.g. central bank reference rate, with its date."
          required
        >
          <TextInput
            value={sourceNote}
            maxLength={500}
            required
            onChange={(event) => setSourceNote(event.target.value)}
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
          <PillButton type="submit" size="sm">
            Save with this rate
          </PillButton>
        </div>
      </form>
    </Dialog>
  );
}
