import { describe, expect, it } from "vitest";
import { auditDiff } from "./audit";

describe("auditDiff", () => {
  it("records changed values only", () => {
    expect(
      auditDiff(
        { tagline: "Old", stage: "seed", name: "Kiln" },
        { tagline: "New", stage: "seed", description: undefined },
      ),
    ).toEqual({ tagline: { from: "Old", to: "New" } });
  });

  it("treats a create as a change from null", () => {
    expect(auditDiff(null, { name: "Kiln", tagline: null })).toEqual({
      name: { from: null, to: "Kiln" },
    });
  });

  it("records personal-data fields by name only (ADR-019)", () => {
    const diff = auditDiff(
      { fullName: "Old Name", bio: "Old bio", headline: "Same" },
      { fullName: "New Name", bio: "New bio", headline: "Same" },
      new Set(["fullName", "bio", "headline"]),
    );
    expect(diff).toEqual({
      fullName: { changed: true },
      bio: { changed: true },
    });
    // Neither the old nor the new value of a personal field is kept.
    expect(JSON.stringify(diff)).not.toMatch(/Old|New/);
  });

  it("serializes dates", () => {
    expect(
      auditDiff({ at: null }, { at: new Date("2026-01-02T03:04:05Z") }),
    ).toEqual({ at: { from: null, to: "2026-01-02T03:04:05.000Z" } });
  });
});
