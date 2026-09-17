import "server-only";

import * as cheerio from "cheerio";
import { and, eq, ilike } from "drizzle-orm";
import type { ReadContext } from "../auth/context";
import { assertEditor } from "../auth/guards";
import { getDb } from "../db/client";
import { locations } from "../db/schema";
import type { Image } from "../dto/image";
import {
  PayloadTooLargeError,
  RateLimitedError,
  UnprocessableError,
  UnsafeUrlError,
  UnsupportedMediaTypeError,
  ValidationError,
} from "../lib/errors";
import { getRedis, hitWindow, limitKey } from "../lib/redis";
import { assertSafeUrl, type SafeResponse, safeFetch } from "../lib/safe-fetch";
import { type PrefillInput, prefillSchema } from "../validation/prefill";
import { parseInput } from "../validation/shared";
import { storeRemoteImage } from "./media";

// Paste-a-URL prefill (docs/API.md §8.6, FR-401, SEC-05).
//
// This is the one place the server fetches a URL a caller chose, so every fetch — the page, its
// icons, its og:image, and anything Firecrawl hands back — goes through safeFetch, which validates
// the address on the socket itself. Nothing here is persisted as an entity: the result is a draft
// an editor reviews, and fetched images land as staging assets the GC removes if unused.
// Thin metadata still answers 200 with warnings; only an unsafe URL is a refusal.

export const PREFILL_LIMIT_PER_HOUR = 20;
const HOUR_SECONDS = 3600;
const MAX_TAGLINE = 120;
const MAX_DESCRIPTION = 4000;

const CAREERS_PATH = /\/(careers|jobs|join-us|work-with-us)(\/|$|\?)/i;

/** Hiring platforms a company's own careers link legitimately points at. */
const ATS_HOSTS =
  /(^|\.)(greenhouse\.io|boards\.greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|teamtailor\.com|breezy\.hr|smartrecruiters\.com|recruitee\.com|jobvite\.com|myworkdayjobs\.com|pinpointhq\.com)$/i;

export type Confidence = "high" | "medium" | "low";

export type PrefillAsset = Readonly<{
  assetId: string;
  state: "staging";
  image: Image;
}>;

export type LocationGuess = Readonly<{
  raw: string;
  matchedLocationId: string | null;
}>;

export type PrefillDraft = Readonly<{
  name: string | null;
  tagline: string | null;
  description: string | null;
  websiteUrl: string;
  careersUrl: string | null;
  logo: PrefillAsset | null;
  cover: PrefillAsset | null;
  locationGuess: LocationGuess | null;
  links: Readonly<{
    linkedin: string | null;
    x: string | null;
    github: string | null;
  }>;
  confidence: Readonly<{
    name: Confidence;
    tagline: Confidence;
    description: Confidence;
  }>;
  source: "opengraph" | "json-ld" | "html" | "firecrawl";
  warnings: string[];
}>;

export type FirecrawlMetadata = Readonly<{
  title?: string;
  description?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
}>;

export type PrefillDeps = Readonly<{
  /** Replaced in tests; production always uses safeFetch. */
  fetch?: typeof safeFetch;
  firecrawl?: (url: string) => Promise<FirecrawlMetadata | null>;
  hitWindow?: typeof hitWindow;
}>;

/**
 * 20 per hour per editor, and **fails closed** (SEC-08): this endpoint makes the server talk to a
 * host of the caller's choosing, so without a working limiter it does not run at all.
 */
async function assertPrefillAllowed(
  actorId: string,
  count: typeof hitWindow,
): Promise<void> {
  let hit: { count: number; secondsLeft: number };
  try {
    hit = await count(getRedis(), limitKey("prefill", actorId), HOUR_SECONDS);
  } catch {
    throw new RateLimitedError(60);
  }
  if (hit.count > PREFILL_LIMIT_PER_HOUR) {
    throw new RateLimitedError(hit.secondsLeft);
  }
}

// ── Extraction ───────────────────────────────────────────────────────────────────────────────

type Extracted = {
  name: string | null;
  nameConfidence: Confidence;
  tagline: string | null;
  taglineConfidence: Confidence;
  description: string | null;
  descriptionConfidence: Confidence;
  /** In order of preference; tried one after another until one can be stored. */
  logoUrls: string[];
  coverUrls: string[];
  careersUrl: string | null;
  links: PrefillDraft["links"];
  locationRaw: string | null;
  source: "opengraph" | "json-ld" | "html";
  hadJsonLd: boolean;
};

const clean = (
  value: string | null | undefined,
  max: number,
): string | null => {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? text.slice(0, max).trimEnd() : text;
};

/** The first Organization-ish node in any JSON-LD block, including inside `@graph`. */
function organizationFrom(
  blocks: readonly string[],
): Record<string, unknown> | null {
  const wanted = new Set([
    "Organization",
    "Corporation",
    "LocalBusiness",
    "WebSite",
    "SoftwareApplication",
  ]);
  const visit = (node: unknown): Record<string, unknown> | null => {
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = visit(item);
        if (found) return found;
      }
      return null;
    }
    if (typeof node !== "object" || node === null) return null;
    const record = node as Record<string, unknown>;
    const graph = record["@graph"];
    if (graph !== undefined) {
      const found = visit(graph);
      if (found) return found;
    }
    const type = record["@type"];
    const types = Array.isArray(type) ? type : [type];
    if (types.some((value) => typeof value === "string" && wanted.has(value))) {
      return record;
    }
    return null;
  };

  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      continue; // A site's broken JSON-LD is not our problem.
    }
    const found = visit(parsed);
    if (found) return found;
  }
  return null;
}

const asString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

/** JSON-LD images come as a string, an object with `url`, or an array of either. */
function imageFrom(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = imageFrom(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "object" && value !== null) {
    return asString((value as Record<string, unknown>).url);
  }
  return null;
}

function addressFrom(
  organization: Record<string, unknown> | null,
): string | null {
  const address = organization?.address;
  if (typeof address === "string") return address;
  if (typeof address !== "object" || address === null) return null;
  const record = address as Record<string, unknown>;
  const parts = [
    asString(record.addressLocality),
    asString(record.addressRegion),
    asString(record.addressCountry),
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(", ") : null;
}

/** Resolves a candidate against the page's final URL, and keeps only https. */
function absoluteHttps(candidate: string | null, base: string): string | null {
  if (!candidate) return null;
  try {
    const url = new URL(candidate, base);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Each fetch is a request to a host the page chose, so the list is short. */
const MAX_LOGO_CANDIDATES = 4;
const MAX_COVER_CANDIDATES = 2;

/** Distinct https URLs, resolved against the page, in the order given. */
function candidates(
  values: readonly (string | null | undefined)[],
  base: string,
  max: number,
): string[] {
  const urls: string[] = [];
  for (const value of values) {
    const url = absoluteHttps(value ?? null, base);
    if (url && !urls.includes(url)) urls.push(url);
    if (urls.length === max) break;
  }
  return urls;
}

function extract(html: string, pageUrl: string): Extracted {
  const $ = cheerio.load(html);
  const content = (selector: string) =>
    $(selector).attr("content")?.trim() ?? null;
  const og = (property: string) =>
    content(`meta[property="og:${property}"]`) ??
    content(`meta[name="og:${property}"]`);

  const blocks = $('script[type="application/ld+json"]')
    .map((_, element) => $(element).text())
    .get();
  const organization = organizationFrom(blocks);

  const jsonLdName = clean(asString(organization?.name), 200);
  const siteName = clean(og("site_name"), 200);
  const ogTitle = clean(og("title"), 200);
  // A <title> is usually "Name — tagline"; only the first part is a plausible name.
  const titleTag = clean(
    $("title")
      .first()
      .text()
      .split(/\s[|–—·:]\s/)[0],
    200,
  );

  const jsonLdDescription = clean(
    asString(organization?.description),
    MAX_DESCRIPTION,
  );
  const ogDescription = clean(og("description"), MAX_DESCRIPTION);
  const metaDescription = clean(
    content('meta[name="description"]'),
    MAX_DESCRIPTION,
  );
  const description = jsonLdDescription ?? ogDescription ?? metaDescription;
  const shortest = ogDescription ?? metaDescription ?? jsonLdDescription;

  const name = jsonLdName ?? siteName ?? ogTitle ?? titleTag;
  const nameConfidence: Confidence =
    jsonLdName || siteName ? "high" : ogTitle ? "medium" : "low";

  const hrefs: string[] = [];
  $("a[href]").each((_, element) => {
    const resolved = absoluteHttps($(element).attr("href") ?? "", pageUrl);
    if (resolved) hrefs.push(resolved);
  });
  const anchorHref = (test: RegExp) =>
    hrefs.find((href) => test.test(href)) ?? null;

  const hostOf = (href: string) => {
    try {
      return new URL(href).host.toLowerCase();
    } catch {
      return "";
    }
  };
  const pageHost = hostOf(pageUrl);
  const careersCandidates = hrefs.filter((href) => CAREERS_PATH.test(href));
  // The company's own page first, then a hiring platform it uses. Never a third party's careers
  // page: an acquired company often links its parent's, which is not this company's hiring page.
  const careersUrl =
    careersCandidates.find((href) => hostOf(href) === pageHost) ??
    careersCandidates.find((href) => ATS_HOSTS.test(hostOf(href))) ??
    null;

  const hrefsOf = (selector: string) =>
    $(selector)
      .map((_, element) => $(element).attr("href") ?? "")
      .get()
      .filter(Boolean);
  // Raster icons first: an SVG or ICO is refused, so it is tried only when nothing else is named.
  const looksVector = (href: string) => /\.(svg|ico)(\?|#|$)/i.test(href);
  const icons = [
    ...hrefsOf('link[rel~="apple-touch-icon"]'),
    ...hrefsOf('link[rel~="icon"]'),
  ];
  const iconHrefs = [
    ...icons.filter((href) => !looksVector(href)),
    ...icons.filter(looksVector),
  ];
  if (iconHrefs.length === 0) iconHrefs.push("/favicon.ico");

  return {
    name,
    nameConfidence,
    // A tagline must fit the column; a long sentence is description material, not a tagline.
    tagline: shortest && shortest.length <= MAX_TAGLINE ? shortest : null,
    taglineConfidence: ogDescription ? "medium" : "low",
    description,
    descriptionConfidence: jsonLdDescription
      ? "high"
      : ogDescription
        ? "medium"
        : "low",
    logoUrls: candidates(
      [imageFrom(organization?.logo), ...iconHrefs],
      pageUrl,
      MAX_LOGO_CANDIDATES,
    ),
    coverUrls: candidates(
      [og("image"), content('meta[name="twitter:image"]')],
      pageUrl,
      MAX_COVER_CANDIDATES,
    ),
    careersUrl,
    links: {
      linkedin: anchorHref(/^https:\/\/([a-z]+\.)?linkedin\.com\//i),
      x: anchorHref(/^https:\/\/([a-z]+\.)?(x|twitter)\.com\//i),
      github: anchorHref(/^https:\/\/([a-z]+\.)?github\.com\//i),
    },
    locationRaw: addressFrom(organization) ?? clean(og("locality"), 200),
    source: organization
      ? "json-ld"
      : siteName || ogTitle || ogDescription || og("image")
        ? "opengraph"
        : "html",
    hadJsonLd: organization !== null,
  };
}

// ── Images and location ──────────────────────────────────────────────────────────────────────

/** What storeRemoteImage throws for an image it will not take: not a failure on our side. */
const isImageRefusal = (error: unknown) =>
  error instanceof UnsupportedMediaTypeError ||
  error instanceof PayloadTooLargeError ||
  error instanceof ValidationError ||
  error instanceof UnprocessableError;

/**
 * Tries each candidate in turn and keeps the first image that can be stored. When none can, one
 * warning gives the last reason. A failure on our side (image storage) stops at once, since the
 * next candidate would fail the same way.
 */
async function fetchImage(
  ctx: ReadContext,
  fetcher: typeof safeFetch,
  urls: readonly string[],
  purpose: "logo" | "cover",
  warnings: string[],
): Promise<PrefillAsset | null> {
  let reason: string | null = null;
  for (const candidate of urls) {
    try {
      // Attacker-chosen, exactly like the page: validated again, on its own socket.
      const response = await fetcher(candidate, { accept: "image/*" });
      if (response.status >= 400) {
        reason = `The ${purpose} could not be fetched (${response.status}).`;
        continue;
      }
      const stored = await storeRemoteImage(ctx, {
        purpose,
        bytes: response.body,
        sourceUrl: candidate,
      });
      return { assetId: stored.assetId, state: "staging", image: stored.image };
    } catch (error) {
      if (error instanceof UnsafeUrlError) {
        // Never echoes a resolved address (SEC-05): UnsafeUrlError messages are written for that.
        reason = `The ${purpose} was rejected: ${error.message.replace(/^This URL can't be fetched: /, "")}`;
      } else if (isImageRefusal(error)) {
        reason = `The ${purpose} was rejected: it could not be read as a JPEG, PNG, WebP or AVIF image.`;
      } else {
        // Our side failed (image storage, say), not the image: say so, and keep the detail in the
        // server log rather than in the response (SEC-12).
        console.error(`[prefill] the ${purpose} could not be stored`, error);
        warnings.push(
          `The ${purpose} was found but could not be stored. Check the image storage settings and try again.`,
        );
        return null;
      }
    }
  }
  if (reason) warnings.push(reason);
  return null;
}

async function guessLocation(
  raw: string | null,
): Promise<LocationGuess | null> {
  if (!raw) return null;
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const city = parts[0];
  if (!city) return { raw, matchedLocationId: null };

  const last = parts.at(-1) ?? "";
  const countryCode = /^[A-Za-z]{2}$/.test(last) ? last.toUpperCase() : null;
  const escaped = city.replace(/[\\%_]/g, (character) => `\\${character}`);

  const db = getDb();
  const [match] = await db
    .select({ id: locations.id })
    .from(locations)
    .where(
      countryCode
        ? and(
            ilike(locations.city, escaped),
            eq(locations.countryCode, countryCode),
          )
        : ilike(locations.city, escaped),
    )
    .limit(1);

  return { raw, matchedLocationId: match?.id ?? null };
}

// ── Firecrawl fallback ───────────────────────────────────────────────────────────────────────

/**
 * Optional last resort for pages that need JavaScript. The call itself goes to a host we chose,
 * so it is a plain fetch; every URL it *returns* is attacker-influenced and goes through
 * safeFetch like any other. Without a key, prefill simply returns less.
 */
async function firecrawlScrape(
  url: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<FirecrawlMetadata | null> {
  const key = env.FIRECRAWL_API_KEY;
  if (!key) return null;
  try {
    const response = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      data?: { metadata?: FirecrawlMetadata };
    };
    return payload.data?.metadata ?? null;
  } catch {
    return null;
  }
}

// ── The service ──────────────────────────────────────────────────────────────────────────────

export async function prefill(
  ctx: ReadContext,
  input: PrefillInput,
  deps: PrefillDeps = {},
): Promise<PrefillDraft> {
  assertEditor(ctx);
  const { url } = parseInput(prefillSchema, input);
  await assertPrefillAllowed(ctx.actor.id, deps.hitWindow ?? hitWindow);

  const fetcher = deps.fetch ?? safeFetch;
  const firecrawl = deps.firecrawl ?? firecrawlScrape;
  const warnings: string[] = [];

  // Refused before anything is opened; the message never names a resolved address.
  const target = assertSafeUrl(url);

  let page: SafeResponse | null = null;
  try {
    page = await fetcher(target.toString(), {
      accept: "text/html,application/xhtml+xml",
    });
  } catch (error) {
    // An unsafe URL is the caller's answer (400); a site being down is only a warning.
    if (error instanceof UnsafeUrlError) throw error;
    warnings.push("The page could not be fetched.");
  }

  const isHtml = page !== null && page.status < 400;
  let extracted: Extracted | null = null;
  if (isHtml && page) {
    extracted = extract(page.body.toString("utf8"), page.url);
    if (!extracted.hadJsonLd) {
      warnings.push("No JSON-LD found; details came from meta tags.");
    }
  } else if (page !== null) {
    warnings.push(`The page answered ${page.status}.`);
  }

  let source: PrefillDraft["source"] = extracted?.source ?? "html";
  let name = extracted?.name ?? null;
  let tagline = extracted?.tagline ?? null;
  let description = extracted?.description ?? null;
  let coverUrls = extracted?.coverUrls ?? [];

  // Only when the page itself yielded nothing worth showing an editor.
  if (name === null && description === null) {
    const metadata = await firecrawl(target.toString());
    if (metadata) {
      source = "firecrawl";
      name = clean(metadata.ogTitle ?? metadata.title, 200);
      const summary = clean(
        metadata.ogDescription ?? metadata.description,
        MAX_DESCRIPTION,
      );
      description = summary;
      tagline = summary && summary.length <= MAX_TAGLINE ? summary : null;
      coverUrls = candidates(
        [metadata.ogImage],
        target.toString(),
        MAX_COVER_CANDIDATES,
      );
    } else {
      warnings.push(
        "Little could be read from this page; fill the fields in by hand.",
      );
    }
  }

  const [logo, cover] = await Promise.all([
    fetchImage(ctx, fetcher, extracted?.logoUrls ?? [], "logo", warnings),
    fetchImage(ctx, fetcher, coverUrls, "cover", warnings),
  ]);

  return {
    name,
    tagline,
    description,
    websiteUrl: target.toString(),
    careersUrl: extracted?.careersUrl ?? null,
    logo,
    cover,
    locationGuess: await guessLocation(extracted?.locationRaw ?? null),
    links: extracted?.links ?? { linkedin: null, x: null, github: null },
    confidence: {
      name: extracted?.nameConfidence ?? "low",
      tagline: extracted?.taglineConfidence ?? "low",
      description: extracted?.descriptionConfidence ?? "low",
    },
    source,
    warnings,
  };
}
