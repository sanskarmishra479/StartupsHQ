import { describe, expect, it } from "vitest";
import { isSlug, MAX_SLUG_LENGTH, slugify, withSuffix } from "./slug";

describe("slugify", () => {
  it.each([
    ["Kiln Analytics", "kiln-analytics"],
    ["Café Algorithmique", "cafe-algorithmique"],
    ["Wisła Robotics", "wisla-robotics"],
    ["Zürich", "zurich"],
    ["São Paulo", "sao-paulo"],
    ["Kraków", "krakow"],
    ["Tomasz Wróbel", "tomasz-wrobel"],
    ["Straße Øresund Æther", "strasse-oresund-aether"],
    ["Humans&", "humans-and"],
    ["  --Acme   Robotics!!  ", "acme-robotics"],
    ["Y Combinator W24", "y-combinator-w24"],
    ["佐藤 花子 Hanami", "hanami"],
  ])("%s → %s", (name, expected) => {
    expect(slugify(name)).toBe(expected);
    expect(isSlug(expected)).toBe(true);
  });

  it("returns an empty slug for a name with no Latin characters", () => {
    expect(slugify("佐藤 花子")).toBe("");
    expect(slugify("  ···  ")).toBe("");
  });

  it("caps length without leaving a trailing hyphen", () => {
    const slug = slugify(`${"word ".repeat(40)}end`);
    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    expect(slug.endsWith("-")).toBe(false);
    expect(isSlug(slug)).toBe(true);
  });
});

describe("isSlug", () => {
  it.each([
    "",
    "Acme",
    "acme--robotics",
    "-acme",
    "acme-",
    "acme robotics",
    "acmé",
  ])("rejects %j", (value) => {
    expect(isSlug(value)).toBe(false);
  });

  it("rejects slugs longer than the maximum", () => {
    expect(isSlug("a".repeat(MAX_SLUG_LENGTH + 1))).toBe(false);
  });
});

describe("withSuffix", () => {
  it("numbers collisions from 2", () => {
    expect(withSuffix("acme", 1)).toBe("acme");
    expect(withSuffix("acme", 2)).toBe("acme-2");
    expect(withSuffix("acme", 13)).toBe("acme-13");
  });

  it("stays within the maximum length", () => {
    const suffixed = withSuffix("a".repeat(MAX_SLUG_LENGTH), 12);
    expect(suffixed).toHaveLength(MAX_SLUG_LENGTH);
    expect(isSlug(suffixed)).toBe(true);
  });
});
