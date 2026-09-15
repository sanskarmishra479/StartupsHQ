import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { closeDb, getDb } from "../../../server/db/client";
import { industries, locations } from "../../../server/db/schema";
import { seed } from "../../../server/db/seed";
import type { RouteHandler } from "../../../server/http/handler";
import { cursorSecret, encodeCursor } from "../../../server/lib/cursor";
import * as lifecycle from "../../../server/services/lifecycle";
import * as startupWrites from "../../../server/services/startup-writes";
import { contexts } from "../../../server/testing/authz";
import * as contract from "../../../server/testing/contract";
import { ensureTestUsers } from "../../../server/testing/users";
import robots from "../../robots";
import { GET as getBatch } from "./batches/[slug]/route";
import { GET as getCategory } from "./categories/[kind]/[slug]/route";
import { GET as getCategories } from "./categories/route";
import { GET as getFounder } from "./founders/[slug]/route";
import { GET as getPortfolio } from "./investors/[slug]/portfolio/route";
import { GET as getRoundsLed } from "./investors/[slug]/rounds-led/route";
import { GET as getInvestor } from "./investors/[slug]/route";
import { GET as getRounds } from "./rounds/route";
import { GET as getSearch } from "./search/route";
import { GET as getStartup } from "./startups/[slug]/route";
import { GET as getSimilar } from "./startups/[slug]/similar/route";
import { GET as getStartups } from "./startups/route";
import { GET as getSuggest } from "./suggest/route";

// API contract tests for the read endpoints (docs/API.md §6, TEST_PLAN §9, SEC-15). Handlers are
// called exactly as Next.js calls them; every body is validated against the documented DTO.

const ORIGIN = "https://startupshq.test";

beforeAll(async () => {
  await seed(getDb());
  await ensureTestUsers();
});

afterAll(async () => {
  await closeDb();
});

function call(
  route: RouteHandler,
  path: string,
  params: Record<string, string> = {},
): Promise<Response> {
  return route(new Request(`${ORIGIN}/api/v1${path}`), {
    params: Promise.resolve(params),
  });
}

async function read<S extends z.ZodType>(
  response: Response | Promise<Response>,
  schema: S,
  status = 200,
): Promise<z.output<S>> {
  const resolved = await response;
  const text = await resolved.text();
  expect(resolved.status, text).toBe(status);
  expect(resolved.headers.get("content-type")).toContain("application/json");
  const parsed = schema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
  return parsed.data;
}

async function expectError(
  response: Promise<Response>,
  status: number,
  code: string,
) {
  const body = await read(response, contract.errorBody, status);
  expect(body.error.code).toBe(code);
  return body.error;
}

const cards = contract.pageOf(contract.startupCard);
const news = contract.pageOf(contract.newsItem);
const slugsOf = (items: readonly { slug: string }[]) =>
  items.map((item) => item.slug);

/** Follows `nextCursor` to the end, returning every slug in order. */
async function walkStartups(
  query: string,
  limit: number,
  cursor: string | null = null,
): Promise<string[]> {
  const slugs: string[] = [];
  let next = cursor;
  do {
    const params = new URLSearchParams(query);
    params.set("limit", String(limit));
    if (next) params.set("cursor", next);
    const page = await read(call(getStartups, `/startups?${params}`), cards);
    slugs.push(...slugsOf(page.data));
    next = page.pagination.nextCursor;
  } while (next);
  return slugs;
}

describe("GET /startups", () => {
  it("lists published, non-acquired companies by default", async () => {
    const page = await read(call(getStartups, "/startups?limit=48"), cards);
    const slugs = slugsOf(page.data);
    expect(slugs).toContain("kiln-analytics");
    expect(slugs).not.toContain("stealth-draft-co");
    expect(slugs).not.toContain("sunset-legacy");
    expect(slugs).not.toContain("pebble-notes");
    expect(page.pagination).toEqual({
      nextCursor: null,
      hasMore: false,
      limit: 48,
    });
  });

  it("serves the unfiltered first page from the shared cache with the same content", async () => {
    const cached = await read(call(getStartups, "/startups"), cards);
    const uncached = await read(call(getStartups, "/startups?limit=24"), cards);
    expect(cached).toEqual(uncached);
  });

  it("applies each facet", async () => {
    const acquired = await read(
      call(getStartups, "/startups?include_acquired=true&limit=48"),
      cards,
    );
    expect(slugsOf(acquired.data)).toContain("pebble-notes");

    const staged = await read(
      call(getStartups, "/startups?stage=seed&stage=series_a&limit=48"),
      cards,
    );
    expect(staged.data.length).toBeGreaterThan(0);
    expect(
      staged.data.every((card) =>
        ["seed", "series_a"].includes(card.stage ?? ""),
      ),
    ).toBe(true);

    const cases: [string, string][] = [
      ["industry=devtools&work_type=onsite", "kiln-analytics"],
      ["city=berlin-de", "kiln-analytics"],
      ["country=de", "kiln-analytics"],
      ["batch=parallel-w25", "lanternfish-ai"],
      ["founder=mira-okafor", "lanternfish-ai"],
      ["q=warehouse", "kiln-analytics"],
    ];
    for (const [query, expected] of cases) {
      const page = await read(call(getStartups, `/startups?${query}`), cards);
      expect(slugsOf(page.data), query).toContain(expected);
    }
  });

  it("ignores unknown parameters", async () => {
    await read(call(getStartups, "/startups?utm_source=newsletter"), cards);
  });

  it.each([
    ["stage=unicorn", "stage"],
    ["work_type=space", "work_type"],
    ["industry=Not%20A%20Slug", "industry"],
    ["country=DEU", "country"],
    ["q=a", "q"],
    ["include_acquired=yes", "include_acquired"],
    ["sort=hot", "sort"],
    ["sort=name&sort=raised", "sort"],
    ["limit=ten", "limit"],
    ["limit=-1", "limit"],
  ])("rejects %s with field details", async (query, field) => {
    const error = await expectError(
      call(getStartups, `/startups?${query}`),
      400,
      "VALIDATION_ERROR",
    );
    expect(error.details?.[0]?.path.startsWith(field)).toBe(true);
  });

  it("clamps limit to 48 (SEC-15)", async () => {
    const page = await read(call(getStartups, "/startups?limit=500"), cards);
    expect(page.pagination.limit).toBe(48);
  });

  it.each([
    "recent",
    "raised",
    "name",
  ])("pages through sort=%s without gaps or repeats", async (sort) => {
    const all = await walkStartups(`sort=${sort}&include_acquired=true`, 48);
    expect(all.length).toBeGreaterThan(10);
    expect(await walkStartups(`sort=${sort}&include_acquired=true`, 5)).toEqual(
      all,
    );
  });

  it.each([
    "recent",
    "raised",
    "name",
  ])("keeps sort=%s stable when a company is published mid-walk", async (sort) => {
    const before = await walkStartups(`sort=${sort}`, 48);
    const first = await read(
      call(getStartups, `/startups?sort=${sort}&limit=4`),
      cards,
    );
    expect(slugsOf(first.data)).toEqual(before.slice(0, 4));

    const [location] = await getDb()
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.slug, "berlin-de"));
    const [industry] = await getDb()
      .select({ id: industries.id })
      .from(industries)
      .where(eq(industries.slug, "devtools"));
    const created = await startupWrites.create(contexts.editor, {
      name: `Aaa Stability Probe ${sort}`,
      tagline: "Inserted between two page requests.",
      locationId: location?.id,
      industries: [{ id: industry?.id ?? "", isPrimary: true }],
    });
    await lifecycle.publish(contexts.editor, "startup", created.id);

    try {
      const rest = await walkStartups(
        `sort=${sort}`,
        4,
        first.pagination.nextCursor,
      );
      expect(rest.filter((slug) => slug !== created.slug)).toEqual(
        before.slice(4),
      );
      expect(new Set(rest).size).toBe(rest.length);
    } finally {
      // A once-published record can only be archived, which also hides it from later walks.
      await lifecycle.archive(contexts.editor, "startup", created.id);
    }
  });

  it("rejects a tampered cursor and a cursor from another sort", async () => {
    const page = await read(
      call(getStartups, "/startups?sort=name&limit=2"),
      cards,
    );
    const cursor = page.pagination.nextCursor ?? "";
    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith("A") ? "B" : "A"}`;

    for (const query of [
      `sort=name&cursor=${encodeURIComponent(tampered)}`,
      `sort=raised&cursor=${encodeURIComponent(cursor)}`,
      "cursor=v1.e30.bm90LWEtc2lnbmF0dXJl",
    ]) {
      const error = await expectError(
        call(getStartups, `/startups?${query}`),
        400,
        "VALIDATION_ERROR",
      );
      expect(error.details).toEqual([
        { path: "cursor", message: "Invalid cursor." },
      ]);
    }
  });

  it("stops anonymous callers after 20 pages (SEC-15)", async () => {
    const cursorFor = (page: number) =>
      encodeURIComponent(
        encodeCursor(
          {
            sort: "recent",
            key: ["2020-01-01T00:00:00.000Z"],
            id: "00000000-0000-4000-8000-000000000000",
            page,
          },
          cursorSecret(),
        ),
      );
    await read(call(getStartups, `/startups?cursor=${cursorFor(20)}`), cards);
    await expectError(
      call(getStartups, `/startups?cursor=${cursorFor(21)}`),
      400,
      "PAGINATION_DEPTH",
    );
  });
});

describe("entity detail endpoints", () => {
  it("returns a published startup in the Startup contract", async () => {
    const response = call(getStartup, "/startups/kiln-analytics", {
      slug: "kiln-analytics",
    });
    const { data } = await read(response, contract.single(contract.startup));
    expect(data.slug).toBe("kiln-analytics");
  });

  it("redirects an old slug with a 301 to the current path", async () => {
    const response = await call(getStartup, "/startups/kiln-data", {
      slug: "kiln-data",
    });
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/api/v1/startups/kiln-analytics`,
    );
  });

  it.each<[string, RouteHandler, string, string]>([
    ["startup", getStartup, "startups", "stealth-draft-co"],
    ["startup", getStartup, "startups", "sunset-legacy"],
    ["startup", getStartup, "startups", "no-such-company"],
    ["startup", getStartup, "startups", "Not A Slug"],
    ["similar", getSimilar, "startups", "stealth-draft-co"],
    ["founder", getFounder, "founders", "unverified-founder"],
    ["founder", getFounder, "founders", "former-founder"],
    ["investor", getInvestor, "investors", "quietwater-capital"],
    ["investor", getInvestor, "investors", "old-mill-ventures"],
    ["portfolio", getPortfolio, "investors", "quietwater-capital"],
    ["rounds-led", getRoundsLed, "investors", "old-mill-ventures"],
    ["batch", getBatch, "batches", "parallel-w26"],
    ["batch", getBatch, "batches", "parallel-s24"],
  ])("hides the %s %s/%s behind a 404", async (_label, route, collection, slug) => {
    await expectError(
      call(route, `/${collection}/${encodeURIComponent(slug)}`, { slug }),
      404,
      "NOT_FOUND",
    );
  });

  it("returns similar companies, never the subject", async () => {
    const { data } = await read(
      call(getSimilar, "/startups/kiln-analytics/similar", {
        slug: "kiln-analytics",
      }),
      contract.single(z.array(contract.startupCard).max(9)),
    );
    expect(slugsOf(data)).not.toContain("kiln-analytics");
  });

  it("returns a founder with their companies", async () => {
    const { data } = await read(
      call(getFounder, "/founders/mira-okafor", { slug: "mira-okafor" }),
      contract.single(contract.founder),
    );
    expect(data.startups.map((stint) => stint.startup.slug)).toContain(
      "lanternfish-ai",
    );
  });

  it("returns an investor, their portfolio and the rounds they led", async () => {
    const params = { slug: "northwind-ventures" };
    await read(
      call(getInvestor, "/investors/northwind-ventures", params),
      contract.single(contract.investor),
    );
    await read(
      call(
        getPortfolio,
        "/investors/northwind-ventures/portfolio?limit=2",
        params,
      ),
      cards,
    );
    await read(
      call(getRoundsLed, "/investors/northwind-ventures/rounds-led", params),
      news,
    );
    await expectError(
      call(
        getPortfolio,
        "/investors/northwind-ventures/portfolio?stage=unicorn",
        params,
      ),
      400,
      "VALIDATION_ERROR",
    );
  });

  it("returns a batch with its cohort", async () => {
    const { data } = await read(
      call(getBatch, "/batches/parallel-w25", { slug: "parallel-w25" }),
      contract.single(contract.batch),
    );
    expect(slugsOf(data.companies)).toContain("lanternfish-ai");
  });

  it("sends no field the contract does not list", async () => {
    const response = await call(getStartup, "/startups/kiln-analytics", {
      slug: "kiln-analytics",
    });
    const text = await response.text();
    expect(text).not.toMatch(
      /"(status|createdBy|updatedBy|createdAt|deletedAt)"/,
    );
  });
});

describe("GET /rounds", () => {
  async function walkRounds(query: string, limit: number) {
    const items: z.output<typeof contract.newsItem>[] = [];
    let cursor: string | null = null;
    do {
      const params = new URLSearchParams(query);
      params.set("limit", String(limit));
      if (cursor) params.set("cursor", cursor);
      const page = await read(call(getRounds, `/rounds?${params}`), news);
      items.push(...page.data);
      cursor = page.pagination.nextCursor;
    } while (cursor);
    return items;
  }

  it("returns the feed newest first, without unpublished rounds", async () => {
    await read(call(getRounds, "/rounds"), news);
    const all = await walkRounds("", 48);
    const dates = all.map((item) => item.round.announcedOn);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(
      all.some(
        (item) =>
          item.startup.slug === "solstice-grid" &&
          ["series_b", "bridge"].includes(item.round.roundType),
      ),
    ).toBe(false);
    expect((await walkRounds("", 3)).map((item) => item.round.id)).toEqual(
      all.map((item) => item.round.id),
    );
  });

  it("filters by round type", async () => {
    const seed = await walkRounds("round_type=seed", 48);
    expect(seed.length).toBeGreaterThan(0);
    expect(seed.every((item) => item.round.roundType === "seed")).toBe(true);
  });

  it.each([
    "from=2026-02-30",
    "to=yesterday",
    "round_type=mega",
    "investor=Bad%20Slug",
  ])("rejects %s", async (query) => {
    await expectError(
      call(getRounds, `/rounds?${query}`),
      400,
      "VALIDATION_ERROR",
    );
  });
});

describe("categories", () => {
  it("lists every facet with published companies", async () => {
    const { data } = await read(
      call(getCategories, "/categories"),
      contract.single(contract.categoryDirectory),
    );
    expect(data.map((group) => group.kind)).toEqual([
      "industries",
      "stages",
      "work-type",
      "cities",
      "countries",
    ]);
    const industrySlugs = slugsOf(data[0]?.entries ?? []);
    expect(industrySlugs).toContain("ai");
    expect(industrySlugs).not.toContain("quantum");
  });

  it("returns a category page and marks thin facets noindex", async () => {
    const ai = await read(
      call(getCategory, "/categories/industries/ai", {
        kind: "industries",
        slug: "ai",
      }),
      contract.single(contract.categoryPage),
    );
    expect(ai.data.isIndexable).toBe(true);

    const robotics = await read(
      call(getCategory, "/categories/industries/robotics", {
        kind: "industries",
        slug: "robotics",
      }),
      contract.single(contract.categoryPage),
    );
    expect(robotics.data.isIndexable).toBe(false);
  });

  it.each([
    ["industries", "anything-at-all"],
    ["industries", "quantum"],
    ["planets", "ai"],
    ["stages", "series_a"],
  ])("answers /categories/%s/%s with a 404", async (kind, slug) => {
    await expectError(
      call(getCategory, `/categories/${kind}/${slug}`, { kind, slug }),
      404,
      "NOT_FOUND",
    );
  });
});

describe("search", () => {
  it("returns grouped results without unpublished records", async () => {
    const results = await read(
      call(getSearch, "/search?q=kiln"),
      contract.searchResults,
    );
    expect(slugsOf(results.data.startups.results)).toContain("kiln-analytics");

    const hidden = await read(
      call(getSearch, "/search?q=stealth"),
      contract.searchResults,
    );
    expect(slugsOf(hidden.data.startups.results)).not.toContain(
      "stealth-draft-co",
    );
  });

  it.each([
    "",
    "?q=k",
    "?q=kiln&type=people",
    "?q=kiln&q=pebble",
  ])("rejects /search%s", async (query) => {
    await expectError(
      call(getSearch, `/search${query}`),
      400,
      "VALIDATION_ERROR",
    );
  });

  it("suggests at most 8 published records", async () => {
    const { data } = await read(
      call(getSuggest, "/suggest?q=ki"),
      contract.single(z.array(contract.suggestion).max(8)),
    );
    expect(slugsOf(data)).toContain("kiln-analytics");

    const hidden = await read(
      call(getSuggest, "/suggest?q=stealth"),
      contract.single(z.array(contract.suggestion)),
    );
    expect(slugsOf(hidden.data)).not.toContain("stealth-draft-co");
    await expectError(call(getSuggest, "/suggest"), 400, "VALIDATION_ERROR");
  });
});

describe("robots.txt (SEC-15)", () => {
  it("keeps crawlers out of the API", () => {
    const { rules } = robots();
    const list = Array.isArray(rules) ? rules : [rules];
    expect(list.flatMap((rule) => rule.disallow ?? [])).toContain("/api/");
  });
});
