import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import sharp from "sharp";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { closeDb, getDb } from "../db/client";
import { locations, mediaAssets, startups } from "../db/schema";
import { seed } from "../db/seed";
import { RateLimitedError, UnsafeUrlError } from "../lib/errors";
import { assertSafeUrl, type SafeResponse, safeFetch } from "../lib/safe-fetch";
import { contexts } from "../testing/authz";
import { ensureTestUsers } from "../testing/users";
import { type FirecrawlMetadata, prefill } from "./prefill";

// docs/TEST_PLAN.md §8 SEC-05 and FR-401. The page and every image it names are attacker-chosen,
// so the fake fetcher still runs the real address validation — a hostile URL is refused here
// exactly as in production, and no test ever opens a socket.

const editor = contexts.editor;
const PAGE = "https://acme-robotics.example/";

beforeAll(async () => {
  await seed(getDb());
  await ensureTestUsers();
});

afterAll(async () => {
  await closeDb();
});

// Prefill is budgeted at 20 an hour per account, so each test gets its own counter; the budget
// test below sets its own and exercises the limit deliberately.
const namespace = process.env.RATE_LIMIT_NAMESPACE;
beforeEach(() => {
  process.env.RATE_LIMIT_NAMESPACE = `prefill-${randomUUID()}`;
});
afterEach(() => {
  process.env.RATE_LIMIT_NAMESPACE = namespace;
});

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: "#101820" } })
    .png()
    .toBuffer();

type Fixture = Readonly<{
  status?: number;
  contentType?: string;
  body: string | Buffer;
}>;

/** Serves fixtures, but only for URLs the real safeFetch rules would allow. */
function fetcherFor(fixtures: Record<string, Fixture>): typeof safeFetch {
  return async (input: string): Promise<SafeResponse> => {
    const url = assertSafeUrl(input).toString();
    const fixture = fixtures[url];
    if (!fixture) throw new UnsafeUrlError("it could not be reached.");
    return {
      url,
      status: fixture.status ?? 200,
      contentType: fixture.contentType ?? "text/html; charset=utf-8",
      body: Buffer.isBuffer(fixture.body)
        ? fixture.body
        : Buffer.from(fixture.body),
    };
  };
}

const page = (options: { jsonLd?: string; head?: string; body?: string }) => `
<!doctype html><html><head>
  <title>Acme Robotics — warehouse robots that share one fleet brain</title>
  <meta name="description" content="Acme builds warehouse robots.">
  <meta property="og:site_name" content="Acme Robotics">
  <meta property="og:description" content="Warehouse robots that share one fleet brain.">
  ${options.head ?? ""}
  ${options.jsonLd ? `<script type="application/ld+json">${options.jsonLd}</script>` : ""}
</head><body>
  ${options.body ?? ""}
</body></html>`;

const ORGANIZATION = JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: "Acme Robotics",
      description:
        "Acme Robotics builds warehouse robots that co-ordinate as one fleet.",
      logo: { url: "https://acme-robotics.example/logo.png" },
      address: {
        "@type": "PostalAddress",
        addressLocality: "Berlin",
        addressCountry: "DE",
      },
    },
  ],
});

const LINKS = `
  <a href="/careers">Careers</a>
  <a href="https://www.linkedin.com/company/acme-robotics">LinkedIn</a>
  <a href="https://x.com/acmerobotics">X</a>
  <a href="https://github.com/acme-robotics">GitHub</a>`;

describe("a usable draft from a real page (FR-401)", () => {
  it("reads name, copy, images, links and location", async () => {
    const logo = await png(300, 300);
    const cover = await png(1200, 630);
    const draft = await prefill(
      editor,
      { url: PAGE },
      {
        fetch: fetcherFor({
          [PAGE]: {
            body: page({
              jsonLd: ORGANIZATION,
              head: '<meta property="og:image" content="https://acme-robotics.example/cover.png">',
              body: LINKS,
            }),
          },
          "https://acme-robotics.example/logo.png": {
            contentType: "image/png",
            body: logo,
          },
          "https://acme-robotics.example/cover.png": {
            contentType: "image/png",
            body: cover,
          },
        }),
      },
    );

    expect(draft.name).toBe("Acme Robotics");
    expect(draft.description).toContain("warehouse robots");
    expect(draft.tagline).toBe("Warehouse robots that share one fleet brain.");
    expect(draft.source).toBe("json-ld");
    expect(draft.confidence).toEqual({
      name: "high",
      tagline: "medium",
      description: "high",
    });
    expect(draft.websiteUrl).toBe(PAGE);
    expect(draft.careersUrl).toBe("https://acme-robotics.example/careers");
    expect(draft.links).toEqual({
      linkedin: "https://www.linkedin.com/company/acme-robotics",
      x: "https://x.com/acmerobotics",
      github: "https://github.com/acme-robotics",
    });

    // Images arrive as staging assets, with the URL they came from recorded.
    expect(draft.logo?.state).toBe("staging");
    // 1200 px wide, so only the 640 variant fits: nothing is ever upscaled.
    expect(draft.cover?.image.variants.map((variant) => variant.width)).toEqual(
      [640],
    );
    const [asset] = await getDb()
      .select({
        sourceUrl: mediaAssets.sourceUrl,
        purpose: mediaAssets.purpose,
        state: mediaAssets.state,
      })
      .from(mediaAssets)
      .where(eq(mediaAssets.id, draft.logo?.assetId ?? ""));
    expect(asset).toEqual({
      sourceUrl: "https://acme-robotics.example/logo.png",
      purpose: "logo",
      state: "staging",
    });

    const [berlin] = await getDb()
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.slug, "berlin-de"));
    expect(draft.locationGuess).toEqual({
      raw: "Berlin, DE",
      matchedLocationId: berlin?.id,
    });
  });

  it("persists no entity, whatever it reads", async () => {
    const before = await getDb()
      .select({ count: sql<number>`count(*)::int` })
      .from(startups);
    await prefill(
      editor,
      { url: PAGE },
      {
        fetch: fetcherFor({ [PAGE]: { body: page({ jsonLd: ORGANIZATION }) } }),
      },
    );
    const after = await getDb()
      .select({ count: sql<number>`count(*)::int` })
      .from(startups);
    expect(after[0]?.count).toBe(before[0]?.count);
  });
});

describe("the careers link", () => {
  const draftFor = (body: string) =>
    prefill(
      editor,
      { url: PAGE },
      { fetch: fetcherFor({ [PAGE]: { body: page({ body }) } }) },
    );

  it("prefers the company's own page over a parent company's", async () => {
    // Found on a real site: an acquired company links its parent's careers page too.
    const draft = await draftFor(`
      <a href="https://www.databricks.example/company/careers/open-positions">Careers</a>
      <a href="/careers">Join us</a>`);
    expect(draft.careersUrl).toBe("https://acme-robotics.example/careers");
  });

  it("accepts a hiring platform the company uses", async () => {
    const draft = await draftFor(
      '<a href="https://boards.greenhouse.io/acmerobotics/jobs">Open roles</a>',
    );
    expect(draft.careersUrl).toBe(
      "https://boards.greenhouse.io/acmerobotics/jobs",
    );
  });

  it("takes nothing rather than someone else's careers page", async () => {
    const draft = await draftFor(
      '<a href="https://www.databricks.example/company/careers">Careers</a>',
    );
    expect(draft.careersUrl).toBeNull();
  });
});

describe("hostile URLs are refused (SEC-05)", () => {
  it.each([
    ["loopback", "https://127.0.0.1/"],
    ["localhost", "https://localhost/"],
    ["IPv6 loopback", "https://[::1]/"],
    ["IPv4-mapped IPv6 loopback", "https://[::ffff:127.0.0.1]/"],
    ["cloud metadata", "https://169.254.169.254/latest/meta-data/"],
    ["private 10/8", "https://10.0.0.1/"],
    ["private 172.16/12", "https://172.16.0.1/"],
    ["private 192.168/16", "https://192.168.1.1/"],
    ["carrier-grade NAT", "https://100.64.0.1/"],
    ["a decimal IP", "https://2130706433/"],
    ["plain http", "http://acme-robotics.example/"],
    ["a credentialed URL", "https://user:pass@acme-robotics.example/"],
  ])("refuses %s", async (_label, url) => {
    await expect(prefill(editor, { url })).rejects.toBeInstanceOf(
      UnsafeUrlError,
    );
  });

  it("refuses a host whose DNS answer is private (rebinding)", async () => {
    // A rebinding resolver: whatever it claimed earlier, the address the socket would use is
    // private, so the connection is refused at connect time and nothing is opened.
    const rebinding = (input: string) =>
      safeFetch(input, {
        resolve: async () => [{ address: "127.0.0.1", family: 4 }],
      });
    await expect(
      prefill(editor, { url: PAGE }, { fetch: rebinding }),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("keeps a hostile og:image out, and says so, without failing the draft", async () => {
    const draft = await prefill(
      editor,
      { url: PAGE },
      {
        fetch: fetcherFor({
          [PAGE]: {
            body: page({
              jsonLd: ORGANIZATION,
              head: '<meta property="og:image" content="https://169.254.169.254/latest/meta-data/">',
            }),
          },
          "https://acme-robotics.example/logo.png": {
            contentType: "image/png",
            body: await png(256, 256),
          },
        }),
      },
    );

    expect(draft.cover).toBeNull();
    expect(draft.logo).not.toBeNull();
    expect(draft.warnings.join(" ")).toMatch(/cover was rejected/i);
    // Never names the address it resolved to.
    expect(draft.warnings.join(" ")).not.toContain("169.254.169.254");
  });

  it("refuses an icon that is not a raster image", async () => {
    const draft = await prefill(
      editor,
      { url: PAGE },
      {
        fetch: fetcherFor({
          [PAGE]: {
            body: page({
              head: '<link rel="icon" href="/icon.svg">',
            }),
          },
          "https://acme-robotics.example/icon.svg": {
            contentType: "image/svg+xml",
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>',
          },
        }),
      },
    );
    expect(draft.logo).toBeNull();
    expect(draft.warnings.join(" ")).toMatch(/logo was rejected/i);
  });
});

describe("degrading gracefully", () => {
  it("warns instead of failing when the page cannot be read", async () => {
    const draft = await prefill(
      editor,
      { url: PAGE },
      {
        fetch: fetcherFor({ [PAGE]: { status: 403, body: "denied" } }),
        firecrawl: async () => null,
      },
    );
    expect(draft.name).toBeNull();
    expect(draft.websiteUrl).toBe(PAGE);
    expect(draft.warnings.join(" ")).toMatch(/answered 403/);
    expect(draft.warnings.join(" ")).toMatch(/by hand/);
  });

  it("falls back to Firecrawl, and still validates the URLs it returns", async () => {
    const metadata: FirecrawlMetadata = {
      ogTitle: "Acme Robotics",
      ogDescription: "Warehouse robots.",
      ogImage: "https://10.0.0.1/cover.png",
    };
    const draft = await prefill(
      editor,
      { url: PAGE },
      {
        fetch: fetcherFor({ [PAGE]: { status: 500, body: "boom" } }),
        firecrawl: async () => metadata,
      },
    );
    expect(draft.source).toBe("firecrawl");
    expect(draft.name).toBe("Acme Robotics");
    expect(draft.tagline).toBe("Warehouse robots.");
    expect(draft.cover).toBeNull();
    expect(draft.warnings.join(" ")).toMatch(/cover was rejected/i);
  });

  it("notes when a page has no JSON-LD", async () => {
    const draft = await prefill(
      editor,
      { url: PAGE },
      { fetch: fetcherFor({ [PAGE]: { body: page({}) } }) },
    );
    expect(draft.name).toBe("Acme Robotics");
    expect(draft.source).toBe("opengraph");
    expect(draft.warnings.join(" ")).toMatch(/No JSON-LD/);
  });
});

describe("the prefill budget (SEC-08)", () => {
  it("allows 20 an hour per editor, then refuses", async () => {
    const fetch = fetcherFor({ [PAGE]: { body: page({}) } });

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await prefill(editor, { url: PAGE }, { fetch });
    }
    await expect(
      prefill(editor, { url: PAGE }, { fetch }),
    ).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("fails closed when the limiter is unavailable", async () => {
    const refusal = prefill(
      editor,
      { url: PAGE },
      {
        hitWindow: async () => {
          throw new Error("the store is down");
        },
      },
    );
    await expect(refusal).rejects.toBeInstanceOf(RateLimitedError);
    await expect(refusal).rejects.toMatchObject({ retryAfterSeconds: 60 });
  });
});
