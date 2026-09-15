# startupsHQ — API Contract

**Status:** Specified, not yet implemented · **Version:** v1 (draft 2) · **Last updated:** 2026-09-15
**Requirements authority:** [SRS.md](./SRS.md) · This document is the authority on **paths, params, DTO shapes and status codes**.

> **How to read this document.** It is written **design-first**: it specifies the contract handlers must satisfy, not code that exists. TODO Phase 8 implements it; Phase 12 verifies every shape against the real handlers via the contract tests in [TEST_PLAN.md](./TEST_PLAN.md) §9. If implementation diverges, both this document and the handler are suspect — resolve deliberately.
>
> **The contract freezes at the end of TODO Phase 8.** After that the frontend is written against it; a breaking change requires a new version prefix.

---

## 1. Conventions

| Aspect | Rule |
|---|---|
| Origins | **Reads:** `https://startupshq.com/api/v1`. **Writes, auth, admin reads:** `https://admin.startupshq.com/api/v1`. Write paths on the public origin return `404` (ADR-014). Domain TBD. Host routing (`src/proxy.ts`): on any host other than the admin origin — including preview hostnames — `/admin/*`, `/api/auth/*` and every non-`GET`/`HEAD` `/api/v1/*` return `404` (JSON for `/api/*`). The admin origin serves only `/admin/*`, `/api/auth/*` and `/api/v1/*`: `/` redirects to `/admin`, `/admin/*` without a session cookie redirects to `/admin/login`, anything else is `404`, and every response carries `X-Robots-Tag: noindex, nofollow`. |
| Transport | HTTPS only. JSON bodies; `POST /media` and `POST /import/dry-run` are `multipart/form-data`. |
| Casing | **JSON `camelCase`; database `snake_case`.** DTO mappers are the only translation point. |
| Money | Integer **whole US dollars** (`30000000` = $30M), never float or formatted string. Non-USD rounds also carry `currency`, `amountOriginal`, `fxRate`, `fxRateDate`. Formatting is the client's job. |
| Totals | `totalRaisedUsd` = equity + convertible rounds only. `totalDebtUsd` separate. Grants and secondaries appear in `rounds` but never in totals (ADR-018). |
| Dates | `YYYY-MM-DD` for dates; ISO 8601 UTC for timestamps. |
| Nulls | Unknown ⇒ `null`, always present, never omitted. |
| Enums | Exactly the values in SRS §4.1, `snake_case`. |
| IDs | Public reads address entities by **slug**; writes by **id** (uuid). Internal ids never appear in public read DTOs, except `rounds[].id` where needed for anchors. |
| Old slugs | A read by a slug in `slug_redirects` returns `301` with `Location` pointing at the current slug's path. |
| Unknown params | Unknown query params ignored. Unknown **body** fields rejected (`z.strictObject`). |

## 2. Authentication, authorization & CSRF

- Public reads: no credentials. Cached reads use `PublicReadContext`; others `publicContext()`.
- Writes: Better Auth session cookie (host-only on the admin origin, httpOnly, `Secure`, `SameSite=Lax`) from a login that **completed TOTP 2FA**, and role `editor` or `admin`. `/users` and `/privacy` endpoints require `admin`.
- **CSRF (every non-GET on the admin origin):** `Origin` must equal the admin origin (fallback `Sec-Fetch-Site: same-origin`) → otherwise `403 FORBIDDEN`. JSON endpoints require `Content-Type: application/json` → otherwise `415`.
- Authorization is enforced in three layers (SEC-03.5). **A public caller never sees a `draft` or `archived` record** — requesting one returns `404`, not `403`.

## 3. Response envelopes

**Single resource** — `{ "data": { … } }`

**Collection** — keyset cursor pagination

```json
{
  "data": [ { "slug": "highstock" }, { "slug": "rogo" } ],
  "pagination": { "nextCursor": "v1.eyJzIjoicmVjZW50Ii…​.Hk3…", "hasMore": true, "limit": 24 }
}
```

- `nextCursor` is opaque, **HMAC-signed**, and encodes the sort, the sort key value and `id`. Pass it back verbatim with the **same** `sort`; a cursor used with a different sort, or tampered with, returns `400`.
- Anonymous callers may follow at most **20 pages** per listing; the 21st returns `400` with `code: "PAGINATION_DEPTH"` (SEC-15). Narrow the filters instead.
- `nextCursor` is `null` when `hasMore` is `false`.

**Error**

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid request body.",
             "details": [ { "path": "foundedYear", "message": "Must be between 1900 and 2027." } ] } }
```

`details` only on `VALIDATION_ERROR`. No stack traces, SQL, table names or internal ids (SEC-12).

## 4. Status & error codes

| Status | `code` | When |
|---|---|---|
| 200 / 201 / 204 | — | Success / created / no content |
| 301 | — | Old slug; see `Location` |
| 400 | `VALIDATION_ERROR` · `PAGINATION_DEPTH` · `UNSAFE_URL` | Bad input, tampered/mismatched cursor, depth exceeded, prefill URL rejected |
| 401 | `UNAUTHORIZED` | No valid session, or 2FA not completed |
| 403 | `FORBIDDEN` | Wrong role, or failed origin check |
| 404 | `NOT_FOUND` | Unknown slug/id; non-published record for a public caller; nonexistent facet value; write path on the public origin |
| 409 | `CONFLICT` · `IMPORT_STALE` · `IMPORT_EXPIRED` | Slug taken; duplicate link; data changed since dry-run; dry-run older than 24 h |
| 413 | `PAYLOAD_TOO_LARGE` | Upload over 5 MB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Wrong `Content-Type`, or disallowed/mismatched file type |
| 422 | `UNPROCESSABLE` · `IMAGE_TOO_LARGE` | Semantic violation (see per-endpoint); image over 24 MP |
| 429 | `RATE_LIMITED` | Over budget (§5) |
| 500 | `INTERNAL` | Unexpected; detail in Sentry only |

## 5. Rate limits (SEC-08)

| Surface | Budget | Enforced by | Key |
|---|---|---|---|
| All public `GET /api/v1/*` | e.g. 300 / min, bot challenge on list endpoints | **Vercel WAF (edge)** | IP + JA4 |
| `POST /api/auth/sign-in` | 20 / 15 min hard; progressive delay per email after 5 failures (1 s → 30 s); **no lockout** | Upstash | IP; email |
| `POST /prefill` | 20 / hour | Upstash | user |
| Other writes | 120 / min | Upstash | user |

Exact WAF thresholds are tuned after launch from real traffic. App-level `429`s carry `Retry-After`. Login and prefill **fail closed** if Upstash is unavailable.

---

# 6. Read endpoints (public origin)

## 6.1 `GET /startups` — explore grid *(FR-101)*

| Param | Type | Notes |
|---|---|---|
| `stage` | enum, repeatable | OR within the facet |
| `industry` | slug, repeatable | |
| `work_type` | enum, repeatable | |
| `city` | location slug, repeatable | |
| `country` | ISO-3166 alpha-2 | |
| `batch` · `investor` · `founder` | slug | |
| `q` | string, 2–100 | Full-text **filter** over name, tagline and description; results keep the requested `sort`, so keyset pagination stays stable. Relevance-ranked results are `GET /search` |
| `include_acquired` | boolean, default `false` | |
| `sort` | `recent` (default) \| `raised` \| `name` | Each sort has its own keyset index (DM-13) |
| `cursor` | opaque, signed | Must match `sort` |
| `limit` | 1–48, default 24 | Clamped |

Facets AND together; repeated values within a facet OR. Returns `StartupCard[]`.

## 6.2 `GET /startups/{slug}` *(FR-102)*

Returns `Startup`. `404` unknown/draft/archived; `301` old slug.

## 6.3 `GET /startups/{slug}/similar`

Up to 9 `StartupCard[]`: same primary industry, then stage, then city. Never includes the subject.

## 6.4 `GET /founders/{slug}` *(FR-103)*

Returns `Founder` with **every** startup, `joinedYear DESC`. A founder with no startups returns an empty array, not 404.

## 6.5 `GET /investors/{slug}` *(FR-104)*

Returns `Investor` with counts, breakdown and first portfolio page.

## 6.6 `GET /investors/{slug}/portfolio`

`cursor`, `limit` (1–48), `stage`, `industry`. Returns `StartupCard[]`.

## 6.7 `GET /investors/{slug}/rounds-led`

Rounds with `is_lead = true` for this investor. `cursor`, `limit`. Returns `NewsItem[]`.

## 6.8 `GET /batches/{slug}` *(FR-105)*

Returns `Batch` with stats and first cohort page.

## 6.9 `GET /rounds` — news feed *(FR-106)*

`cursor`, `limit` (1–48), `round_type`, `investor`, `industry`, `from`, `to`. Ordered `announcedOn DESC, id`. Returns `NewsItem[]`.

## 6.10a `GET /categories` *(FR-107)*

Every facet value with ≥ 1 published company, grouped by kind in the order `industries`, `stages`, `work-type`, `cities`, `countries`:

```json
{ "data": [ { "kind": "industries",
              "entries": [ { "slug": "ai", "name": "AI", "companyCount": 312, "isIndexable": true } ] } ] }
```

Entries within a kind are ordered by name, except stages and work types, which keep their enum order. Counts include acquired companies and match the category page's `companyCount`.

## 6.10 `GET /categories/{kind}/{slug}` *(FR-108)*

`kind` ∈ `industries` | `stages` | `work-type` | `cities` | `countries`. Slugs: industry slug; stage and work-type enum values with `-` for `_` (`series-a`, `pre-seed`, `onsite`); a city location slug; a **country-level** location slug (a `locations` row with no city, e.g. `india`). Counts and the company list include acquired companies.

- **`404` unless the facet value exists and has ≥ 1 published company.** `/categories/industries/anything-at-all` is a 404.
- A real value with no `taxonomy_pages` row returns generated copy with `isGenerated: true`.
- `isIndexable: false` when fewer than 5 published companies — the page renders `noindex`.

Returns `CategoryPage`.

## 6.11 `GET /search` *(FR-109)*

`q` (required, 2–100), `type` (`all` | `startups` | `founders` | `investors` | `batches`), `limit` (1–24, default 12 per group). Full-text with trigram fallback. **Not cached per query.** Returns `SearchResults`.

## 6.12 `GET /suggest`

`q` (1–60). At most 8 results across all types, trigram-ranked, p95 ≤ 150 ms. Not cached per query.

```json
{ "data": [ { "type": "startup", "slug": "highstock", "name": "Highstock",
              "subtitle": "Consumer · Series A · New York", "logo": { "…Image…": true } } ] }
```

---

# 7. Read DTOs

## 7.0 `Image`

```json
{
  "url": "https://…blob…/a7f3c9/256.webp",
  "blurDataUrl": "data:image/webp;base64,…",
  "width": 256,
  "height": 256,
  "variants": [ { "width": 64, "url": "…/64.webp" }, { "width": 128, "url": "…/128.webp" }, { "width": 256, "url": "…/256.webp" } ]
}
```

`url` is the largest variant. Build `srcset` from `variants`. Images are served directly from Blob, not through an optimizer (ADR-012). A founder without a photo has `photo: null` — render an initials avatar.

## 7.1 `StartupCard`

```json
{
  "slug": "highstock",
  "name": "Highstock",
  "tagline": "The AI-native B2B marketplace.",
  "logo": { "…Image…": true },
  "cover": { "…Image…": true },
  "stage": "series_a",
  "workType": "onsite",
  "primaryIndustry": { "slug": "consumer", "name": "Consumer", "iconUrl": "https://…" },
  "location": { "slug": "new-york", "city": "New York", "country": "United States", "countryCode": "US" },
  "latestRound": { "roundType": "series_a", "amountUsd": 30000000, "isUndisclosed": false, "announcedOn": "2026-09-10" },
  "totalRaisedUsd": 34500000,
  "acquiredBy": null
}
```

`logo`, `cover`, `location`, `primaryIndustry`, `latestRound`, `totalRaisedUsd` are nullable. `acquiredBy` is `null` or `{ "name": "Bending Spoons", "slug": "bending-spoons" | null }`.

## 7.2 `Startup`

`StartupCard` plus:

```json
{
  "description": "Highstock is a B2B marketplace…",
  "legalName": "Highstock Inc.",
  "websiteUrl": "https://www.highstock.com/",
  "careersUrl": "https://www.highstock.com/careers",
  "links": { "linkedin": "https://…", "x": null, "github": null },
  "foundedYear": 2023,
  "foundedOn": null,
  "headcountBand": "11-50",
  "isActive": true,
  "totalDebtUsd": null,
  "industries": [ { "slug": "consumer", "name": "Consumer", "isPrimary": true } ],
  "founders": [ { "slug": "jane-doe", "fullName": "Jane Doe", "headline": "Co-founder & CEO",
                  "photo": null, "role": "cofounder", "isCurrent": true, "joinedYear": 2023, "leftYear": null } ],
  "investors": [ { "slug": "andreessen-horowitz", "name": "Andreessen Horowitz", "investorType": "vc",
                   "logo": { "…Image…": true }, "isLead": true } ],
  "batches": [ { "slug": "yc-w24", "programName": "Y Combinator", "label": "W24", "year": 2024 } ],
  "rounds": [ { "…Round…": true } ],
  "acquiredOn": null,
  "acquiredAmountUsd": null,
  "ogImageUrl": "https://…blob…/og/1200.webp",
  "updatedAt": "2026-09-11T09:14:22Z"
}
```

`investors` is the de-duplicated "Backed by" set; per-round participants live on each round (ADR-005). `rounds` newest-first.

## 7.3 `Round`

```json
{
  "id": "9f1c…",
  "roundType": "series_a",
  "roundClass": "equity",
  "announcedOn": "2026-09-10",
  "isUndisclosed": false,
  "amountUsd": 30000000,
  "currency": "USD",
  "amountOriginal": 30000000,
  "fxRate": 1,
  "fxRateDate": "2026-09-10",
  "valuationUsd": null,
  "sourceUrl": "https://wwd.com/…",
  "sourceTitle": "Highstock raises $30M",
  "investors": [ { "slug": "andreessen-horowitz", "name": "Andreessen Horowitz", "logo": { "…Image…": true }, "isLead": true } ]
}
```

For a €20M round: `"currency": "EUR", "amountOriginal": 20000000, "fxRate": 1.0842, "fxRateDate": "2026-09-09", "amountUsd": 21684000`. When `isUndisclosed` is `true`, `amountOriginal`, `amountUsd`, `fxRate` and `fxRateDate` are all `null` — render "Undisclosed", never `$0`. `roundClass` tells the client whether the round counts toward totals.

## 7.4 `Founder`

```json
{
  "slug": "jane-doe",
  "fullName": "Jane Doe",
  "headline": "Co-founder & CEO at Highstock",
  "bio": "Previously founded…",
  "photo": null,
  "links": { "linkedin": "https://…", "x": null, "github": null, "personal": null },
  "location": { "slug": "new-york", "city": "New York", "country": "United States", "countryCode": "US" },
  "startups": [ { "startup": { "…StartupCard…": true },
                  "role": "cofounder", "isCurrent": true, "joinedYear": 2023, "leftYear": null } ],
  "startupCount": 3,
  "ogImageUrl": "https://…",
  "updatedAt": "2026-09-11T09:14:22Z"
}
```

A founder may appear more than once for the same startup with different roles or tenures (DM-10).

## 7.5 `Investor`

```json
{
  "slug": "andreessen-horowitz",
  "name": "Andreessen Horowitz",
  "investorType": "vc",
  "description": "…",
  "logo": { "…Image…": true },
  "websiteUrl": "https://a16z.com/",
  "foundedYear": 2009,
  "aumUsd": null,
  "hqLocation": { "slug": "menlo-park", "city": "Menlo Park", "country": "United States", "countryCode": "US" },
  "portfolioCount": 42,
  "roundsLedCount": 11,
  "breakdown": {
    "byStage":    [ { "stage": "seed", "count": 18 } ],
    "byIndustry": [ { "slug": "ai", "name": "AI", "count": 20 } ]
  },
  "portfolio": [ { "…StartupCard…": true } ],
  "pagination": { "nextCursor": "…", "hasMore": true, "limit": 24 },
  "ogImageUrl": "https://…"
}
```

## 7.6 `Batch`

```json
{
  "slug": "yc-w24",
  "programName": "Y Combinator",
  "label": "W24",
  "season": "winter",
  "year": 2024,
  "startsOn": "2024-01-08",
  "demoDayOn": "2024-04-03",
  "description": "…",
  "logo": { "…Image…": true },
  "investor": { "slug": "y-combinator", "name": "Y Combinator", "investorType": "accelerator", "logo": { "…Image…": true } },
  "stats": { "companyCount": 240, "totalRaisedUsd": 1840000000,
             "topIndustries": [ { "slug": "ai", "name": "AI", "count": 96 } ] },
  "companies": [ { "…StartupCard…": true } ],
  "pagination": { "nextCursor": "…", "hasMore": true, "limit": 24 }
}
```

`investor` is nullable.

## 7.7 `NewsItem`

```json
{ "round": { "…Round…": true }, "startup": { "…StartupCard…": true } }
```

## 7.8 `CategoryPage`

```json
{
  "kind": "industries",
  "slug": "ai",
  "heading": "Top AI startups",
  "intro": "Markdown copy…",
  "iconUrl": "https://…",
  "seoTitle": "Top AI Startups in 2026 | startupsHQ",
  "seoDescription": "…",
  "isGenerated": false,
  "isIndexable": true,
  "companyCount": 312,
  "companies": [ { "…StartupCard…": true } ],
  "pagination": { "nextCursor": "…", "hasMore": true, "limit": 24 }
}
```

## 7.9 `SearchResults`

```json
{
  "data": {
    "startups":  { "results": [ { "…StartupCard…": true } ], "total": 12 },
    "founders":  { "results": [ { "slug": "jane-doe", "fullName": "Jane Doe", "headline": "…", "photo": null, "startupCount": 3 } ], "total": 2 },
    "investors": { "results": [ { "slug": "a16z", "name": "…", "investorType": "vc", "logo": { "…Image…": true }, "portfolioCount": 42 } ], "total": 1 },
    "batches":   { "results": [ { "slug": "yc-w24", "programName": "Y Combinator", "label": "W24", "year": 2024, "companyCount": 240 } ], "total": 1 }
  },
  "meta": { "query": "highstock", "matchType": "fulltext" }
}
```

`meta.matchType` is `fulltext` or `trigram`.

---

# 8. Write & admin endpoints (admin origin)

All require a 2FA-completed session with role `editor` or `admin` unless noted, pass the CSRF checks in §2, and are Zod-validated with unknown fields rejected. Every successful mutation writes an `audit_log` row (personal fields by name only) and calls `revalidateTag(tag, { expire: 0 })` for affected tags.

## 8.1 Entity lifecycle

For each of `startups`, `founders`, `investors`, `batches`, `rounds`:

| Method | Path | Notes |
|---|---|---|
| `GET` | `/{entity}?status=&q=&cursor=` | Admin list, includes drafts and archived. Uncached. |
| `GET` | `/{entity}/{id}` | Admin read, includes drafts. Uncached. |
| `POST` | `/{entity}` | Creates `draft`. Slug generated from name; an explicit free slug is honoured, else `409`. → `201` |
| `PATCH` | `/{entity}/{id}` | Partial update. Changing `slug` here → `422` (use §8.2). |
| `POST` | `/{entity}/{id}/publish` | → `published`; sets `first_published_at` once. `422` if required fields missing (name, slug, tagline, location for startups). Renders and stores the OG image (FR-111). |
| `POST` | `/{entity}/{id}/unpublish` | → `draft`. |
| `DELETE` | `/{entity}/{id}` | **Archives** (`status = archived`, `archived_at`). → `204`. Publicly 404 from then on. |
| `POST` | `/{entity}/{id}/restore` | Archived → `draft`. |
| `DELETE` | `/{entity}/{id}?hard=true` | **Admin only.** Permitted only when `first_published_at` is null, else `422`. Cascades a startup's rounds and join rows. |

**`POST /startups`** — nested relations in one transaction:

```json
{
  "name": "Highstock",
  "tagline": "The AI-native B2B marketplace.",
  "description": "…",
  "websiteUrl": "https://www.highstock.com/",
  "stage": "series_a",
  "workType": "onsite",
  "headcountBand": "11-50",
  "foundedYear": 2023,
  "locationId": "3c0a…",
  "logoAssetId": "m-51c2…",
  "coverAssetId": "m-9b7e…",
  "industries": [ { "id": "1f2e…", "isPrimary": true } ],
  "founders":  [ { "founderId": "8a7b…", "role": "cofounder", "isCurrent": true, "joinedYear": 2023,
                   "sourceUrl": "https://www.highstock.com/about" } ],
  "investors": [ { "investorId": "4d5c…", "isLead": true } ],
  "batchIds":  [ "9e8d…" ],
  "rounds":    [ { "roundType": "series_a", "announcedOn": "2026-09-10", "currency": "EUR",
                   "amountOriginal": 20000000, "sourceUrl": "https://…", "investors": [ { "investorId": "4d5c…", "isLead": true } ] } ]
}
```

- Rounds never accept `amountUsd`, `fxRate` or `fxRateDate` — the server computes them (FR-406). A currency without an ECB rate returns `422` unless an **admin** supplies `"manualFx": { "rate": 0.00061, "sourceNote": "…" }`. A manual rate is refused (`422`) when an ECB rate exists within 7 days before `announcedOn`; its source note is appended to the round's `notes`. `amountOriginal` is an integer or a decimal string with at most 2 decimals. `PATCH /rounds/{id}` does not change participants; use §8.3.
- `isUndisclosed: true` with any amount → `422`.
- Referenced media assets must be `staging` or already attached to this entity; they become `attached` on commit.

## 8.2 `POST /{entity}/{id}/slug` — change slug *(admin only, FR-409)*

`{ "slug": "new-slug" }` → `200`. The old slug is added to `slug_redirects`, chains are flattened, caches for both slugs are expired. `409` if taken.

## 8.3 Relationship sub-resources

| Method | Path | Body |
|---|---|---|
| `POST` | `/startups/{id}/founders` | `{ founderId, role, isCurrent?, joinedYear?, leftYear?, sortOrder?, sourceUrl? }` → `201 { id }`. `isCurrent` defaults to true unless `leftYear` is given |
| `DELETE` | `/startups/{id}/founders/{linkId}` | Removes one stint → `204` |
| `POST` | `/startups/{id}/investors` | `{ investorId, roundId?, isLead?, amountUsd? }` → `201 { id }`. `roundId` must be one of this startup's rounds (`422`) |
| `DELETE` | `/startups/{id}/investors/{linkId}` | → `204` |
| `POST` | `/startups/{id}/batches` | `{ batchId }` → `204` |
| `DELETE` | `/startups/{id}/batches/{batchId}` | → `204` |
| `PUT` | `/startups/{id}/industries` | `{ industries: [ { id, isPrimary } ] }` — replaces the set; > 1 primary → `422` |

Duplicate link → `409` (enforced by `NULLS NOT DISTINCT` uniqueness). `leftYear < joinedYear` → `422`.

## 8.4 `PATCH /categories/{kind}/{slug}` *(FR-205)*

`{ heading, intro, seoTitle, seoDescription, iconUrl, sortOrder }`. Upserts `taxonomy_pages` **only for an existing facet value** — otherwise `404`.

## 8.5 `POST /media` *(SEC-06, FR-408)*

`multipart/form-data`: `file`, `purpose` ∈ `logo` | `cover` | `photo`.

Sniffed MIME; allowlist jpg/png/webp/svg; 5 MB (`413`); 24 MP pixel limit (`422 IMAGE_TOO_LARGE`); SVG rasterized at capped density with external references disallowed; re-encoded to WebP variants; stored under a random prefix as a **staging** asset (garbage-collected after 24 h unless attached).

```json
{ "data": { "assetId": "m-51c2…", "state": "staging", "purpose": "logo",
            "image": { "…Image…": true } } }
```

## 8.6 `POST /prefill` *(FR-401, SEC-05)*

`{ "url": "https://www.highstock.com/" }`

Every fetch — the page, `og:image`, icons and any Firecrawl-returned URL — goes through `safeFetch` (connect-time IP validation, manual re-validated redirects ≤ 3, 5 s, 5 MB). A rejected URL → `400 UNSAFE_URL` with a reason that never includes a resolved internal IP. Thin metadata still returns `200` with a partial draft.

```json
{ "data": {
    "name": "Highstock", "tagline": "The AI-native B2B marketplace.", "description": "…",
    "websiteUrl": "https://www.highstock.com/", "careersUrl": "https://www.highstock.com/careers",
    "logo":  { "assetId": "m-51c2…", "state": "staging", "image": { "…Image…": true } },
    "cover": { "assetId": "m-9b7e…", "state": "staging", "image": { "…Image…": true } },
    "locationGuess": { "raw": "New York, United States", "matchedLocationId": "3c0a…" },
    "links": { "linkedin": "https://…", "x": null },
    "confidence": { "name": "high", "tagline": "medium", "description": "low" },
    "source": "opengraph",
    "warnings": [ "No JSON-LD found; description taken from meta tag.", "og:image rejected: unsafe URL." ] } }
```

Nothing is persisted as an entity and nothing is published.

## 8.7 CSV import *(FR-402, SEC-07)*

**`POST /import/dry-run`** — `multipart/form-data`, `file` (≤ 1,000 rows). Stores the normalized rows and the file's SHA-256.

```json
{ "data": {
    "importJobId": "b4e2…",
    "expiresAt": "2026-09-15T10:00:00Z",
    "rowCount": 20,
    "summary": { "create": 16, "update": 2, "skip": 1, "error": 1 },
    "rows": [
      { "row": 1, "action": "create", "name": "Acme", "slug": "acme" },
      { "row": 7, "action": "skip", "name": "Highstock", "reason": "Duplicate: slug 'highstock' exists" },
      { "row": 9, "action": "skip", "name": "High Stock Inc", "reason": "Possible duplicate of 'Highstock' (similarity 0.91)" },
      { "row": 14, "action": "error", "errors": [ { "path": "announcedOn", "message": "Invalid date '2026-13-02'." } ] }
    ],
    "newFounders": [ "Jane Doe" ], "newInvestors": [ "Parkway VC" ] } }
```

Values are returned and stored raw; the React UI escapes them on render.

**`POST /import/commit`** — `{ "importJobId": "b4e2…" }`. Applies the **stored** rows in one transaction after re-validating against current data. Outcomes: `200` committed (records are drafts) · `409 IMPORT_STALE` with the conflicting rows if data changed since the dry-run (run a new dry-run) · `409 IMPORT_EXPIRED` after 24 h · `409 CONFLICT` if already committed · `422` on any row failure (whole commit rolled back).

**`GET /import/{importJobId}/export.csv`** — the dry-run report as CSV. Formula-prefix characters (`= + - @`, tab, CR) are neutralized **here**, on export (SEC-07).

## 8.8 Users *(admin only, FR-208)*

`GET /users` · `POST /users/invite` `{ email, role }` (sends an email; invitee must enroll 2FA) · `PATCH /users/{id}` `{ role }` · `POST /users/{id}/reset-2fa` (forces re-enrollment, revokes sessions) · `POST /users/{id}/deactivate` (revokes sessions).
An admin cannot demote or deactivate themselves → `422`.

## 8.9 Privacy *(admin only, FR-210, FR-410)*

| Method | Path | Notes |
|---|---|---|
| `GET` | `/privacy/requests?status=` | Earliest due first |
| `POST` | `/privacy/requests` | `{ requestType: access \| correction \| erasure \| objection, subjectEntityType: founder \| user \| other, subjectEntityId?, receivedAt (ISO 8601 with offset), notes? }` → `201`; `dueAt` = received + 30 days; a `receivedAt` in the future → `422` |
| `PATCH` | `/privacy/requests/{id}` | `{ status: completed \| rejected, notes? }`; resolving an already resolved request → `422` |
| `POST` | `/founders/{id}/erase` | `{ "confirm": "ERASE <founder-slug>" }` → `200 { scrubbedAuditRows }`. Removes the founder, their stints and redirects; queues their media for deletion; redacts related `audit_log` rows through `scrub_founder_audit` (SRS §4.12); writes `erasure_log` (SHA-256 of the id only); expires caches. Irreversible. `422` if the confirmation text doesn't match exactly. |

Requests arrive through the published privacy email address; there is deliberately no public write endpoint.

---

## 9. Versioning

`v1` freezes at the end of TODO Phase 8. Additive changes ship within `v1`. Removing or renaming a field, changing a type, or tightening a default requires `/api/v2`, with `v1` kept until no caller remains. Deprecations are dated in this document before removal.

---

**See also:** [SRS.md](./SRS.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) §3 · [TEST_PLAN.md](./TEST_PLAN.md) §9 · [../TODO.md](../TODO.md) Phases 7–8
