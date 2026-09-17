import {
  FOUNDER_ROLE_LABELS,
  INVESTOR_TYPE_LABELS,
  ROUND_TYPE_LABELS,
  STAGE_LABELS,
  WORK_TYPE_LABELS,
} from "@/lib/labels";
import type { AdminEntity } from "@/types/admin";

// What each entity form edits, as data: the fields PATCH accepts (docs/API.md §8.1), how each is
// entered, and how the text in an input becomes the JSON the API validates. The server's Zod
// schemas remain the authority; these only shape the input and catch the obvious before a
// round-trip. Client-safe and pure, so it is unit-tested.

export type Option = Readonly<{ value: string; label: string }>;

export type FieldKind =
  | "text"
  | "textarea"
  | "url"
  | "year"
  | "date"
  | "usd"
  | "select"
  | "location"
  | "media"
  | "checkbox"
  | "record";

export type FieldSpec = Readonly<{
  key: string;
  label: string;
  kind: FieldKind;
  section: string;
  required?: boolean;
  max?: number;
  hint?: string;
  options?: readonly Option[];
  /** `media`: the upload purpose. */
  purpose?: "logo" | "cover" | "photo";
  /** `record`: which entity the id points at. */
  entity?: AdminEntity;
  /** Half width on wide screens. */
  half?: boolean;
}>;

const optionsFrom = (labels: Record<string, string>): Option[] =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

export const STAGE_OPTIONS = optionsFrom(STAGE_LABELS);
export const WORK_TYPE_OPTIONS = optionsFrom(WORK_TYPE_LABELS);
export const ROUND_TYPE_OPTIONS = optionsFrom(ROUND_TYPE_LABELS);
export const FOUNDER_ROLE_OPTIONS = optionsFrom(FOUNDER_ROLE_LABELS);
export const INVESTOR_TYPE_OPTIONS = optionsFrom(INVESTOR_TYPE_LABELS);
export const HEADCOUNT_OPTIONS: readonly Option[] = [
  "1-10",
  "11-50",
  "51-200",
  "201-500",
  "501-1000",
  "1000+",
].map((value) => ({ value, label: `${value.replace("-", "–")} people` }));

/** ECB reference currencies plus USD; anything else needs an admin's manual rate (FR-406). */
export const CURRENCY_OPTIONS: readonly Option[] = [
  "USD",
  "EUR",
  "GBP",
  "INR",
  "JPY",
  "CNY",
  "CAD",
  "AUD",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "HUF",
  "RON",
  "BGN",
  "ISK",
  "TRY",
  "BRL",
  "MXN",
  "ZAR",
  "KRW",
  "SGD",
  "HKD",
  "NZD",
  "IDR",
  "MYR",
  "PHP",
  "THB",
  "ILS",
].map((code) => ({ value: code, label: code }));

export const STARTUP_SECTIONS = [
  "Basics",
  "Media",
  "Classification",
  "Location",
  "Links",
  "Acquisition",
] as const;

export const FIELD_SPECS: Record<AdminEntity, readonly FieldSpec[]> = {
  startup: [
    {
      key: "name",
      label: "Name",
      kind: "text",
      section: "Basics",
      required: true,
      max: 200,
      half: true,
    },
    {
      key: "legalName",
      label: "Legal name",
      kind: "text",
      section: "Basics",
      max: 200,
      half: true,
    },
    {
      key: "tagline",
      label: "Tagline",
      kind: "text",
      section: "Basics",
      max: 120,
      hint: "One line. Required to publish.",
    },
    {
      key: "description",
      label: "Description",
      kind: "textarea",
      section: "Basics",
      max: 4000,
    },
    {
      key: "logoAssetId",
      label: "Logo",
      kind: "media",
      purpose: "logo",
      section: "Media",
      half: true,
    },
    {
      key: "coverAssetId",
      label: "Cover",
      kind: "media",
      purpose: "cover",
      section: "Media",
      half: true,
    },
    {
      key: "stage",
      label: "Stage",
      kind: "select",
      options: STAGE_OPTIONS,
      section: "Classification",
      half: true,
    },
    {
      key: "workType",
      label: "Work type",
      kind: "select",
      options: WORK_TYPE_OPTIONS,
      section: "Classification",
      half: true,
    },
    {
      key: "headcountBand",
      label: "Team size",
      kind: "select",
      options: HEADCOUNT_OPTIONS,
      section: "Classification",
      half: true,
    },
    {
      key: "foundedYear",
      label: "Founded",
      kind: "year",
      section: "Classification",
      half: true,
    },
    {
      key: "isActive",
      label: "Operating",
      kind: "checkbox",
      section: "Classification",
      hint: "Clear for a company that has shut down.",
    },
    {
      key: "locationId",
      label: "Headquarters",
      kind: "location",
      section: "Location",
      hint: "Required to publish.",
    },
    {
      key: "websiteUrl",
      label: "Website",
      kind: "url",
      section: "Links",
      half: true,
    },
    {
      key: "careersUrl",
      label: "Careers page",
      kind: "url",
      section: "Links",
      half: true,
    },
    {
      key: "linkedinUrl",
      label: "LinkedIn",
      kind: "url",
      section: "Links",
      half: true,
    },
    { key: "xUrl", label: "X", kind: "url", section: "Links", half: true },
    {
      key: "githubUrl",
      label: "GitHub",
      kind: "url",
      section: "Links",
      half: true,
    },
    {
      key: "acquiredByStartupId",
      label: "Acquired by (in the directory)",
      kind: "record",
      entity: "startup",
      section: "Acquisition",
      half: true,
    },
    {
      key: "acquiredByName",
      label: "Acquired by (name)",
      kind: "text",
      max: 200,
      section: "Acquisition",
      half: true,
      hint: "When the acquirer is not in the directory.",
    },
    {
      key: "acquiredOn",
      label: "Acquired on",
      kind: "date",
      section: "Acquisition",
      half: true,
    },
    {
      key: "acquiredAmountUsd",
      label: "Price (USD)",
      kind: "usd",
      section: "Acquisition",
      half: true,
    },
  ],
  founder: [
    {
      key: "fullName",
      label: "Full name",
      kind: "text",
      section: "Basics",
      required: true,
      max: 200,
    },
    {
      key: "headline",
      label: "Headline",
      kind: "text",
      section: "Basics",
      max: 160,
    },
    {
      key: "bio",
      label: "Bio",
      kind: "textarea",
      section: "Basics",
      max: 4000,
    },
    {
      key: "photoAssetId",
      label: "Photo",
      kind: "media",
      purpose: "photo",
      section: "Basics",
      hint: "Only with a licence to use it (ADR-019).",
    },
    {
      key: "locationId",
      label: "Based in",
      kind: "location",
      section: "Basics",
    },
    {
      key: "linkedinUrl",
      label: "LinkedIn",
      kind: "url",
      section: "Links",
      half: true,
    },
    { key: "xUrl", label: "X", kind: "url", section: "Links", half: true },
    {
      key: "githubUrl",
      label: "GitHub",
      kind: "url",
      section: "Links",
      half: true,
    },
    {
      key: "personalUrl",
      label: "Website",
      kind: "url",
      section: "Links",
      half: true,
    },
  ],
  investor: [
    {
      key: "name",
      label: "Name",
      kind: "text",
      section: "Basics",
      required: true,
      max: 200,
      half: true,
    },
    {
      key: "investorType",
      label: "Type",
      kind: "select",
      options: INVESTOR_TYPE_OPTIONS,
      section: "Basics",
      required: true,
      half: true,
    },
    {
      key: "description",
      label: "Description",
      kind: "textarea",
      section: "Basics",
      max: 4000,
    },
    {
      key: "logoAssetId",
      label: "Logo",
      kind: "media",
      purpose: "logo",
      section: "Basics",
    },
    {
      key: "websiteUrl",
      label: "Website",
      kind: "url",
      section: "Details",
      half: true,
    },
    {
      key: "hqLocationId",
      label: "Headquarters",
      kind: "location",
      section: "Details",
      half: true,
    },
    {
      key: "foundedYear",
      label: "Founded",
      kind: "year",
      section: "Details",
      half: true,
    },
    {
      key: "aumUsd",
      label: "Assets under management (USD)",
      kind: "usd",
      section: "Details",
      half: true,
    },
  ],
  batch: [
    {
      key: "programName",
      label: "Program",
      kind: "text",
      section: "Basics",
      required: true,
      max: 200,
      half: true,
    },
    {
      key: "label",
      label: "Label",
      kind: "text",
      section: "Basics",
      required: true,
      max: 40,
      half: true,
      hint: "e.g. W25",
    },
    {
      key: "year",
      label: "Year",
      kind: "year",
      section: "Basics",
      required: true,
      half: true,
    },
    {
      key: "season",
      label: "Season",
      kind: "text",
      section: "Basics",
      max: 40,
      half: true,
    },
    {
      key: "investorId",
      label: "Run by (investor)",
      kind: "record",
      entity: "investor",
      section: "Basics",
    },
    {
      key: "startsOn",
      label: "Starts",
      kind: "date",
      section: "Dates",
      half: true,
    },
    {
      key: "demoDayOn",
      label: "Demo day",
      kind: "date",
      section: "Dates",
      half: true,
    },
    {
      key: "description",
      label: "Description",
      kind: "textarea",
      section: "Details",
      max: 4000,
    },
    {
      key: "logoAssetId",
      label: "Logo",
      kind: "media",
      purpose: "logo",
      section: "Details",
    },
  ],
  round: [
    {
      key: "roundType",
      label: "Round",
      kind: "select",
      options: ROUND_TYPE_OPTIONS,
      section: "Round",
      required: true,
      half: true,
    },
    {
      key: "announcedOn",
      label: "Announced",
      kind: "date",
      section: "Round",
      required: true,
      half: true,
    },
    {
      key: "isUndisclosed",
      label: "Amount undisclosed",
      kind: "checkbox",
      section: "Amount",
    },
    {
      key: "currency",
      label: "Currency",
      kind: "select",
      options: CURRENCY_OPTIONS,
      section: "Amount",
      half: true,
    },
    {
      key: "amountOriginal",
      label: "Amount",
      kind: "text",
      section: "Amount",
      half: true,
      hint: "In the round's currency, e.g. 20000000.",
    },
    {
      key: "valuationUsd",
      label: "Valuation (USD)",
      kind: "usd",
      section: "Amount",
      half: true,
    },
    {
      key: "sourceUrl",
      label: "Source URL",
      kind: "url",
      section: "Source",
      required: true,
    },
    {
      key: "sourceTitle",
      label: "Source title",
      kind: "text",
      section: "Source",
      max: 300,
    },
    {
      key: "notes",
      label: "Notes",
      kind: "textarea",
      section: "Source",
      max: 2000,
    },
  ],
};

/** A form value as the inputs hold it. */
export type FormValue = string | boolean | null;
export type FormValues = Record<string, FormValue>;

/** API values → input values: numbers become text, absent values empty. */
export function toFormValues(
  specs: readonly FieldSpec[],
  values: Readonly<Record<string, unknown>>,
): FormValues {
  const form: FormValues = {};
  for (const spec of specs) {
    const value = values[spec.key];
    if (spec.kind === "checkbox") {
      form[spec.key] =
        value === undefined || value === null
          ? spec.key === "isActive"
          : Boolean(value);
    } else {
      form[spec.key] =
        value === undefined || value === null ? "" : String(value);
    }
  }
  return form;
}

export type Parsed = Readonly<{
  body: Record<string, unknown>;
  errors: Record<string, string>;
}>;

const INTEGER = /^\d+$/;

/** Input values → the API's JSON, with the errors a form can report without asking the server. */
export function fromFormValues(
  specs: readonly FieldSpec[],
  form: FormValues,
): Parsed {
  const body: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const spec of specs) {
    const raw = form[spec.key];
    if (spec.kind === "checkbox") {
      body[spec.key] = Boolean(raw);
      continue;
    }
    const text = typeof raw === "string" ? raw.trim() : "";
    if (text === "") {
      if (spec.required) errors[spec.key] = "Required.";
      else body[spec.key] = null;
      continue;
    }
    if (spec.max !== undefined && text.length > spec.max) {
      errors[spec.key] = `At most ${spec.max} characters.`;
      continue;
    }
    switch (spec.kind) {
      case "year": {
        const year = Number(text);
        if (!INTEGER.test(text) || year < 1900 || year > 2100) {
          errors[spec.key] = "Enter a four-digit year.";
        } else body[spec.key] = year;
        break;
      }
      case "usd": {
        const digits = text.replace(/[,\s_$]/g, "");
        if (!INTEGER.test(digits) || !Number.isSafeInteger(Number(digits))) {
          errors[spec.key] = "Whole US dollars, digits only.";
        } else body[spec.key] = Number(digits);
        break;
      }
      case "url":
        if (!/^https:\/\/[^\s]+$/i.test(text)) {
          errors[spec.key] = "Must be an https:// URL.";
        } else body[spec.key] = text;
        break;
      case "date":
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text))
          errors[spec.key] = "Use YYYY-MM-DD.";
        else body[spec.key] = text;
        break;
      default:
        body[spec.key] =
          spec.key === "amountOriginal" ? text.replace(/[,\s_]/g, "") : text;
    }
  }
  return { body, errors };
}

/** Only what changed since the record loaded, so a PATCH never rewrites untouched fields. */
export function changedFields(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(after)) {
    const previous = before[key] ?? null;
    if (JSON.stringify(previous) !== JSON.stringify(value))
      changes[key] = value;
  }
  return changes;
}

export const sectionsOf = (specs: readonly FieldSpec[]) => [
  ...new Set(specs.map((spec) => spec.section)),
];
