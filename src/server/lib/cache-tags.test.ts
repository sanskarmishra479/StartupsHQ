import { describe, expect, it } from "vitest";
import { cacheTags, MAX_TAG_LENGTH } from "./cache-tags";

describe("cacheTags", () => {
  it("builds namespaced tags", () => {
    expect(cacheTags.startup("kiln-analytics")).toBe("startup:kiln-analytics");
    expect(cacheTags.founder("mira-okafor")).toBe("founder:mira-okafor");
    expect(cacheTags.investor("northwind-ventures")).toBe(
      "investor:northwind-ventures",
    );
    expect(cacheTags.batch("parallel-w25")).toBe("batch:parallel-w25");
    expect(cacheTags.category("industries", "ai")).toBe(
      "category:industries:ai",
    );
    expect(cacheTags.startupsList()).toBe("startups:list");
  });

  it("never gives two entity kinds the same tag for the same slug", () => {
    const slug = "same-slug";
    const tags = [
      cacheTags.startup(slug),
      cacheTags.founder(slug),
      cacheTags.investor(slug),
      cacheTags.batch(slug),
    ];
    expect(new Set(tags).size).toBe(tags.length);
  });

  it("refuses a tag Next.js would silently ignore", () => {
    expect(() => cacheTags.startup("a".repeat(MAX_TAG_LENGTH))).toThrow();
  });
});
