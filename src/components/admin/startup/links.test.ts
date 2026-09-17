import { describe, expect, it } from "vitest";
import {
  createBodyFromLinks,
  EMPTY_LINKS,
  linksFromRecord,
  withPrimary,
} from "./links";

describe("linksFromRecord", () => {
  it("reads the admin record's links, with round participants under their round", () => {
    const links = linksFromRecord({
      industries: [{ id: "i1", slug: "ai", name: "AI", isPrimary: true }],
      founders: [
        {
          linkId: "l1",
          founderId: "f1",
          slug: "mira",
          fullName: "Mira Okafor",
          status: "published",
          role: "cto",
          isCurrent: false,
          joinedYear: 2019,
          leftYear: 2021,
          sortOrder: 0,
          sourceUrl: null,
        },
      ],
      investors: [
        {
          linkId: "v1",
          investorId: "n1",
          slug: "nw",
          name: "Northwind",
          status: "published",
          roundId: "r1",
          isLead: true,
          amountUsd: null,
        },
        {
          linkId: "v2",
          investorId: "n2",
          slug: "hc",
          name: "Harbor",
          status: "draft",
          roundId: null,
          isLead: false,
          amountUsd: null,
        },
      ],
      batches: [
        {
          batchId: "b1",
          slug: "w25",
          programName: "Parallel",
          label: "W25",
          year: 2025,
          status: "published",
        },
      ],
      rounds: [
        {
          id: "r1",
          roundType: "seed",
          announcedOn: "2026-01-01",
          status: "published",
          isUndisclosed: false,
          amountUsd: 5000000,
          currency: "EUR",
        },
      ],
    });
    expect(links.founders[0]).toMatchObject({
      fullName: "Mira Okafor",
      leftYear: 2021,
    });
    expect(links.batches[0]?.name).toBe("Parallel W25");
    expect(links.rounds[0]?.participants).toEqual([
      { investorId: "n1", name: "Northwind", isLead: true },
    ]);
    expect(links.investors.map((investor) => investor.roundId)).toEqual([
      "r1",
      null,
    ]);
  });

  it("is empty without links", () => {
    expect(linksFromRecord(undefined)).toEqual(EMPTY_LINKS);
  });
});

describe("createBodyFromLinks", () => {
  it("nests what POST /startups accepts, and nothing for empty sections", () => {
    expect(createBodyFromLinks(EMPTY_LINKS)).toEqual({});
    const body = createBodyFromLinks({
      industries: [{ id: "i1", name: "AI", isPrimary: true }],
      founders: [
        {
          linkId: "t1",
          founderId: "f1",
          fullName: "A",
          status: "draft",
          role: "cofounder",
          isCurrent: true,
          joinedYear: 2023,
          leftYear: null,
          sourceUrl: "https://a.example/about",
        },
      ],
      investors: [
        {
          linkId: "t2",
          investorId: "n1",
          name: "N",
          status: "draft",
          roundId: null,
          isLead: false,
        },
      ],
      batches: [{ batchId: "b1", name: "B", status: "published" }],
      rounds: [
        {
          id: "t3",
          saved: false,
          status: "draft",
          roundType: "series_a",
          announcedOn: "2026-09-10",
          isUndisclosed: false,
          currency: "EUR",
          amountOriginal: "20000000",
          amountUsd: null,
          sourceUrl: "https://news.example/a",
          body: {
            roundType: "series_a",
            announcedOn: "2026-09-10",
            currency: "EUR",
            amountOriginal: "20000000",
            sourceUrl: "https://news.example/a",
          },
          participants: [{ investorId: "n2", name: "M", isLead: true }],
        },
      ],
    });
    expect(body).toEqual({
      industries: [{ id: "i1", isPrimary: true }],
      founders: [
        {
          founderId: "f1",
          role: "cofounder",
          isCurrent: true,
          joinedYear: 2023,
          sourceUrl: "https://a.example/about",
          sortOrder: 0,
        },
      ],
      investors: [{ investorId: "n1", isLead: false }],
      batchIds: ["b1"],
      rounds: [
        {
          roundType: "series_a",
          announcedOn: "2026-09-10",
          currency: "EUR",
          amountOriginal: "20000000",
          sourceUrl: "https://news.example/a",
          investors: [{ investorId: "n2", isLead: true }],
        },
      ],
    });
  });
});

describe("withPrimary", () => {
  it("keeps exactly one primary industry", () => {
    const a = { id: "a", name: "A", isPrimary: false };
    const b = { id: "b", name: "B", isPrimary: true };
    expect(withPrimary([a]).map((i) => i.isPrimary)).toEqual([true]);
    expect(withPrimary([a, b]).map((i) => i.isPrimary)).toEqual([false, true]);
    expect(withPrimary([])).toEqual([]);
  });
});

describe("linkedDrafts", () => {
  it("lists each draft founder, investor, batch and saved round once", async () => {
    const { linkedDrafts } = await import("./links");
    const links = linksFromRecord({
      founders: [
        {
          linkId: "l1",
          founderId: "f1",
          fullName: "A",
          status: "draft",
          role: "ceo",
          isCurrent: true,
        },
        {
          linkId: "l2",
          founderId: "f1",
          fullName: "A",
          status: "draft",
          role: "cto",
          isCurrent: false,
        },
        {
          linkId: "l3",
          founderId: "f2",
          fullName: "B",
          status: "published",
          role: "ceo",
          isCurrent: true,
        },
      ],
      investors: [
        {
          linkId: "v1",
          investorId: "n1",
          name: "N",
          status: "draft",
          roundId: "r1",
          isLead: true,
        },
      ],
      batches: [
        { batchId: "b1", programName: "P", label: "W", status: "archived" },
      ],
      rounds: [
        {
          id: "r1",
          roundType: "seed",
          announcedOn: "2026-01-01",
          status: "draft",
        },
      ],
    });
    expect(linkedDrafts(links)).toEqual([
      { entity: "founder", id: "f1" },
      { entity: "investor", id: "n1" },
      { entity: "round", id: "r1" },
    ]);
  });
});
