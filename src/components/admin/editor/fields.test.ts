import { describe, expect, it } from "vitest";
import {
  changedFields,
  FIELD_SPECS,
  fromFormValues,
  toFormValues,
} from "./fields";

describe("entity field specs", () => {
  it("name only fields the API accepts, once each", () => {
    for (const specs of Object.values(FIELD_SPECS)) {
      const keys = specs.map((spec) => spec.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const key of keys)
        expect(key).not.toMatch(/^(slug|status|amountUsd|fxRate|id)$/);
    }
  });
});

describe("form values", () => {
  const specs = FIELD_SPECS.startup;

  it("round-trips a record's values", () => {
    const values = {
      name: "Kiln Analytics",
      tagline: null,
      foundedYear: 2019,
      isActive: true,
      acquiredAmountUsd: 18000000,
    };
    const form = toFormValues(specs, values);
    expect(form.foundedYear).toBe("2019");
    expect(form.tagline).toBe("");
    const { body, errors } = fromFormValues(specs, form);
    expect(errors).toEqual({});
    expect(body).toMatchObject({
      name: "Kiln Analytics",
      tagline: null,
      foundedYear: 2019,
      isActive: true,
      acquiredAmountUsd: 18000000,
    });
  });

  it("defaults a new startup to operating", () => {
    expect(toFormValues(specs, {}).isActive).toBe(true);
  });

  it("reports what a form can check without the server", () => {
    const form = toFormValues(specs, {});
    Object.assign(form, {
      name: "  ",
      foundedYear: "19",
      websiteUrl: "http://example.com",
      acquiredAmountUsd: "1.5",
      acquiredOn: "2024/01/01",
    });
    expect(fromFormValues(specs, form).errors).toEqual({
      name: "Required.",
      foundedYear: "Enter a four-digit year.",
      websiteUrl: "Must be an https:// URL.",
      acquiredAmountUsd: "Whole US dollars, digits only.",
      acquiredOn: "Use YYYY-MM-DD.",
    });
  });

  it("accepts dollar amounts written with separators", () => {
    const form = toFormValues(specs, { name: "X" });
    form.acquiredAmountUsd = "$18,000,000";
    expect(fromFormValues(specs, form).body.acquiredAmountUsd).toBe(18_000_000);
    const round = toFormValues(FIELD_SPECS.round, {});
    Object.assign(round, {
      roundType: "seed",
      announcedOn: "2026-09-10",
      sourceUrl: "https://example.com/a",
      amountOriginal: "20,000,000.50",
    });
    expect(fromFormValues(FIELD_SPECS.round, round).body.amountOriginal).toBe(
      "20000000.50",
    );
  });
});

describe("changedFields", () => {
  it("keeps only real changes, treating a missing value as null", () => {
    expect(
      changedFields(
        { name: "A", tagline: null, foundedYear: 2019 },
        { name: "A", tagline: null, foundedYear: 2020, legalName: null },
      ),
    ).toEqual({ foundedYear: 2020 });
  });
});
