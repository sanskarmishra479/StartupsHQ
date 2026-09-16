# startupsHQ — Software Requirements Specification

**Status:** Draft v2 · **Last updated:** 2026-09-16 · Companion to [PRD.md](./PRD.md)

Requirement IDs are stable and referenced from tests and `TODO.md`: `FR-*` functional, `SEC-*` security, `NFR-*` non-functional, `DM-*` data model.

> **v2 (2026-09-14):** revised after a full review against current Next.js 16, Vercel, Neon, Upstash and Better Auth documentation. Key changes: Next.js 16 caching/proxy APIs, cache-safe public reads, admin subdomain with split CSP, SSRF rebinding defence, 2FA, soft delete + independent backups, FX conversion, migrations moved out of the build step, GDPR handling. Rationale lives in [ARCHITECTURE.md](./ARCHITECTURE.md) ADR-012 … ADR-020.

---

## 1. Scope & definitions

This document is the authority on **requirements**: schema, authorization semantics, security and non-functional budgets. [API.md](./API.md) is the authority on the **endpoint contract** (paths, params, DTO shapes, status codes) and must satisfy the requirements here. When code and a document disagree, one of them is a bug — resolve explicitly, don't drift.

| Term | Meaning |
|---|---|
| **Entity** | One of: startup, founder, investor, batch, funding round |
| **Service** | A function in `src/server/services/*` — the only code that touches the DB |
| **ctx** | `RequestContext` — the caller's identity, required first arg of every service function |
| **PublicReadContext** | The cache-safe, identity-free context accepted by cached public reads (§5.2) |
| **DTO** | The shaped object a service returns; never a raw DB row |
| **Facet** | A filterable dimension: industry, stage, work type, city, country |
| **Public origin** | `https://startupshq.space` — public site and read API |
| **Admin origin** | `https://admin.startupshq.space` — admin UI and all write API |

## 2. Technology

| Layer | Technology | Notes |
|---|---|---|
| Runtime | Node 24 (local: v24.14.1) | Next.js 16 requires ≥ 20.9 |
| Package manager | pnpm 12 (12.4.1 via corepack, pinned in `packageManager`) | Lockfile committed; hardened per SEC-13 |
| Framework | **Next.js 16**, App Router, React 19.2 | Cache Components (`'use cache'`), `proxy.ts` (not `middleware.ts`), Turbopack |
| Language | TypeScript 5, `strict: true` | `noUncheckedIndexedAccess` on |
| DB | PostgreSQL 17 — Docker local (17.11, digest-pinned, loopback-only), Neon prod | Driver: `pg` (node-postgres) everywhere, via `drizzle-orm/node-postgres`. Extensions: `pg_trgm`, `unaccent` (via an IMMUTABLE wrapper, DM-13) |
| ORM | Drizzle ORM + drizzle-kit | Migrations committed as SQL |
| Auth | Better Auth | Email + password, **mandatory TOTP 2FA**, role column |
| Email | Transactional provider (Resend or Postmark) | Invites, password reset, 2FA recovery |
| Styling | Tailwind CSS v4 + shadcn/ui (Radix) | |
| Validation | Zod | One schema per entity, shared client/server |
| Images | Vercel Blob + `sharp` | Sizes **pre-generated at upload**; served directly, not through the Vercel image optimizer (ADR-012) |
| Outbound HTTP | `safeFetch` (undici agent with connect-time IP validation) | Every server-side fetch of a URL we did not author (SEC-05) |
| Scraping | `cheerio`; Firecrawl API as fallback | Prefill only |
| CSV | `papaparse` | |
| Rate limiting | **Vercel WAF** at the edge for public API; `@upstash/ratelimit` for login + prefill only | ADR-017 |
| Error monitoring | Sentry, PII scrubbing on | Required before launch (NFR-07) |
| Lint/format | Biome | |
| Tests | Vitest (unit/integration) + Playwright (e2e) | |
| CI / ops jobs | GitHub Actions | CI, migrations, nightly backups, retention, media GC — free standard runners on the public repo (ADR-021) |
| Hosting | Vercel + Neon + Vercel Blob; Cloudflare R2 for backups | Free tiers for development only — see NFR-12 |

## 3. Architecture

### 3.1 The boundary

```
┌─ BROWSER ───────────────────────────────────────────────────────────┐
│  startupshq.space: cached HTML · fetch /api/v1 (reads, no credentials) │
│  admin.startupshq.space: admin UI · fetch /api/v1 (writes, cookie)     │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ HTTPS
                     ┌──────────▼──────────┐
                     │ Vercel WAF (edge)   │  rate limits · bot challenge
                     └──────────┬──────────┘
┌─ SERVER ──────────────────────▼─────────────────────────────────────┐
│  proxy.ts            host routing: /admin + writes only on admin     │
│  src/app/(public)/   UI — no DB import, never reads cookies          │
│  src/app/admin/      UI — admin host only                            │
│  src/app/api/v1/     parse → origin check → Zod → authz → service   │
│  src/server/**  'server-only'   THE data layer                      │
│      ctx-first services · PublicReadContext cached reads · Drizzle   │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ TLS, pooled, app role (DML only)
                           ┌────▼─────┐
                           │ Postgres │
                           └──────────┘
```

**Server Components call services in-process; all browser-originated requests go through `/api/v1`** (ADR-002). Public pages use only cached reads with `PublicReadContext` (ADR-013). All writes are served exclusively from the admin origin (ADR-014).

### 3.2 Source tree

```
startupsHQ/
├── docs/                         README · PRD · SRS · API · ARCHITECTURE · TEST_PLAN
├── TODO.md                       build sequence, backend → frontend
├── docker-compose.yml            local Postgres 17
├── drizzle.config.ts
├── next.config.ts                headers, CSP (public), images.unoptimized
├── pnpm-workspace.yaml           supply-chain settings (SEC-13)
├── biome.json · vitest.config.mts · vitest.setup.ts · playwright.config.ts
├── .env.example
├── SECURITY.md                   private vulnerability reporting (SEC-20)
├── .github/workflows/
│   ├── ci.yml                    lint → typecheck → tests → build → leak scan → audit
│   ├── migrate.yml               migrations on merge to main, protected env (ADR-015)
│   ├── backup.yml                nightly encrypted pg_dump → R2 (SEC-17)
│   ├── restore-test.yml          monthly restore verification
│   ├── audit.yml                 weekly full-lockfile pnpm audit (SEC-13)
│   └── maintenance.yml           audit retention · media GC · FX rate import
├── drizzle/                      generated SQL migrations (committed)
├── scripts/
│   ├── seed.ts                   fixture data (also seeds the preview branch)
│   ├── seed-admin.ts             creates first admin user
│   ├── check-bundle-leak.ts      scans client bundle for secret values/patterns
│   ├── lib/leak-scan.ts          the scanner (unit-tested)
│   ├── recompute-derived.ts      repair derived totals
│   └── fixtures/                 CSV fixtures
└── src/
    ├── server/                   ← 'server-only'. THE ONLY DB ACCESS.
    │   ├── db/
    │   │   ├── client.ts         the single module reading DATABASE_URL
│   │   ├── derived.ts        derived startup totals, published rounds only (FR-404)
│   │   ├── seed/             fictional fixtures + idempotent seed
    │   │   ├── schema/           startups founders investors batches rounds
    │   │   │                     taxonomy joins media redirects fx auth ops enums index
    │   │   └── relations.ts
    │   ├── auth/
    │   │   ├── context.ts        RequestContext, PublicReadContext, constructors
    │   │   ├── guards.ts         assertEditor, assertAdmin
    │   │   ├── visibility.ts     visibilityFilter(ctx)
    │   │   └── better-auth.ts    auth instance, 2FA plugin, adapter
    │   ├── cache/                'use cache' public reads — PublicReadContext only
    │   ├── services/             startups founders investors batches rounds taxonomy
    │   │                         search media prefill import audit stats fx privacy
    │   ├── validation/           one Zod module per entity + shared.ts
    │   ├── dto/                  row → DTO mappers
    │   ├── testing/              authz conformance harness (TEST_PLAN §7)
    │   └── lib/                  fx cursor ip origin safe-fetch cache-tags errors
    ├── lib/                      client-safe pure helpers: slug money
    ├── app/
    │   ├── (public)/             page routes, see §6.1
    │   ├── admin/                admin host only
    │   ├── api/v1/
    │   ├── layout.tsx
    │   └── sitemap.ts robots.ts
    ├── components/               ui/ · cards/ · media/ · data/ · brand/ · landing/ · filters/ · forms/ · layout/
    ├── hooks/
    ├── lib/                      client-safe utils ONLY
    ├── types/
    └── proxy.ts                  host routing + /admin gate (layer 1 of 3)
```

**Rule:** nothing under `src/app/(public)`, `src/components`, `src/hooks` or `src/lib` may import from `src/server/**`. `server-only` makes violations a build error.

## 4. Data model

Common to all entity tables (startups, founders, investors, batches, funding_rounds): `id uuid pk default gen_random_uuid()`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null`, `created_by uuid → users.id`, `updated_by uuid → users.id`, `status publish_status not null default 'draft'`, `first_published_at timestamptz` (set once, never cleared), `archived_at timestamptz`.

### 4.1 Enums (DM-01)

| Enum | Values |
|---|---|
| `stage` | bootstrapped, pre_seed, seed, series_a, series_b, series_c, series_d, series_e, series_f, series_g, growth, public, acquired, dead |
| `round_type` | pre_seed, seed, series_a … series_g, convertible, bridge, debt, grant, secondary |
| `round_class` | equity, convertible, debt, non_dilutive, secondary — **derived** from `round_type` (DM-06) |
| `work_type` | remote, onsite, hybrid |
| `headcount_band` | 1-10, 11-50, 51-200, 201-500, 501-1000, 1000+ |
| `investor_type` | vc, accelerator, angel, corporate, pe, government, crowdfunding |
| `publish_status` | draft, published, archived |
| `founder_role` | founder, cofounder, ceo, cto, operator, advisor, early_employee |
| `taxonomy_kind` | industry, stage, work_type, city, country |
| `user_role` | admin, editor |
| `media_purpose` | logo, cover, photo, og |
| `media_state` | staging, attached |
| `import_status` | dry_run, committed, expired, failed |

### 4.2 `startups` (DM-02)

| Column | Type | Constraints |
|---|---|---|
| slug | text | unique, not null, `^[a-z0-9-]+$` |
| name | text | not null |
| legal_name | text | |
| tagline | text | ≤ 120 chars |
| description | text | ≤ 4000 chars |
| website_url, careers_url | text | https URL |
| linkedin_url, x_url, github_url | text | https URL |
| logo_asset_id, cover_asset_id, og_asset_id | uuid → media_assets | nullable |
| stage | `stage` | |
| work_type | `work_type` | |
| headcount_band | `headcount_band` | |
| founded_year | integer | range validated in Zod (1900 … current year + 1) — **not** a DB CHECK, which would depend on the current date |
| founded_on | date | nullable; precise date when known |
| location_id | uuid → locations | |
| is_active | boolean | not null default true |
| acquired_by_startup_id | uuid → startups | self-FK, nullable |
| acquired_by_name | text | fallback when acquirer not in DB |
| acquired_on | date | |
| acquired_amount_usd | bigint | |
| total_raised_usd | bigint | **derived** — Σ `amount_usd` of rounds with `round_class` ∈ {equity, convertible} |
| total_debt_usd | bigint | **derived** — Σ `amount_usd` of rounds with `round_class` = debt |
| latest_round_id | uuid → funding_rounds | **derived** — latest equity/convertible round by `announced_on` |
| search_vector | tsvector | generated: `simple` config over `immutable_unaccent(name)` (A) + tagline (B) + description (C) |

**Check constraints:** `acquired_on` requires `acquired_by_startup_id` or `acquired_by_name`; `extract(year from founded_on) = founded_year` when both present.

### 4.3 `founders` (DM-03)

`slug` unique · `full_name` not null · `headline` ≤ 160 · `bio` ≤ 4000 · `photo_asset_id` → media_assets (nullable; initials avatar when absent — SEC-18) · `og_asset_id` → media_assets · `linkedin_url`, `x_url`, `github_url`, `personal_url` · `location_id` → locations · `search_vector` = `simple` over `immutable_unaccent(full_name)` (A) + headline (B) + bio (C).

### 4.4 `investors` (DM-04)

`slug` unique · `name` not null · `investor_type` not null · `description` ≤ 4000 · `logo_asset_id`, `og_asset_id` · `website_url` · `founded_year` · `hq_location_id` → locations · `aum_usd bigint` · `search_vector` = `simple` over `immutable_unaccent(name)` (A) + description (C).

### 4.5 `batches` (DM-05)

`slug` unique (e.g. `yc-w24`) · `investor_id` → investors (nullable — YC is both an investor and a batch organizer) · `program_name` not null · `label` not null · `season` · `year` integer not null · `starts_on` · `demo_day_on` · `description` · `logo_asset_id`, `og_asset_id`. Unique on (`investor_id`, `label`, `year`) **NULLS NOT DISTINCT**.

### 4.6 `funding_rounds` (DM-06)

| Column | Type | Constraints |
|---|---|---|
| startup_id | uuid → startups | not null, on delete cascade (only reachable via hard delete of a never-published startup, FR-407) |
| round_type | `round_type` | not null |
| round_class | `round_class` | **generated** from `round_type`: pre_seed…series_g → equity; convertible, bridge → convertible; debt → debt; grant → non_dilutive; secondary → secondary |
| announced_on | date | not null |
| is_undisclosed | boolean | not null default false |
| currency | char(3) | not null default 'USD' |
| amount_original | numeric(20,2) | amount in `currency` as reported |
| amount_usd | bigint | **computed server-side**, never editor-entered (FR-406) |
| fx_rate | numeric(18,8) | USD per 1 unit of `currency`; `1` for USD |
| fx_rate_date | date | rate date used (≤ `announced_on`) |
| fx_source | text | `ecb` \| `manual` (manual requires admin, FR-406) |
| valuation_usd | bigint | |
| source_url | text | not null (the press article) |
| source_title, notes | text | |

**Checks:** `is_undisclosed = true` ⟺ `amount_original is null and amount_usd is null`. `currency <> 'USD' and not is_undisclosed` ⟹ `fx_rate, fx_rate_date, fx_source` all not null.

### 4.7 `locations` (DM-07)

`slug` unique · `city` · `region` · `country` not null · `country_code char(2)` not null · `lat`, `lng` numeric. Unique on (`city`, `country_code`) **NULLS NOT DISTINCT**.

### 4.8 `industries` (DM-08)

`slug` unique · `name` not null · `icon_url` · `description`.

### 4.9 `taxonomy_pages` (DM-09)

`kind taxonomy_kind` · `slug` · `heading` · `intro` (markdown) · `icon_url` · `seo_title` · `seo_description` · `sort_order int`. Unique on (`kind`, `slug`).

Holds editable copy/SEO for facet values. Facet **values** stay typed (enum columns, real FKs); only presentation is data. A row may exist only for a facet value that exists (enforced in the service). A missing row degrades to a generated heading — but a facet value that does not exist is a 404 (FR-108).

### 4.10 Join tables (DM-10)

| Table | Columns | Constraints / notes |
|---|---|---|
| `startup_founders` | id pk, startup_id, founder_id, role `founder_role`, is_current bool, joined_year int, left_year int, sort_order int, source_url text | Unique (startup_id, founder_id, role, joined_year) **NULLS NOT DISTINCT** — a founder may leave and return, or change role. Check `left_year ≥ joined_year`. |
| `investments` | id pk, startup_id, investor_id, round_id (nullable → funding_rounds), is_lead bool, amount_usd bigint | Unique (startup_id, investor_id, round_id) **NULLS NOT DISTINCT** — without it Postgres permits unlimited duplicate `(s, i, NULL)` rows. "Backed by" = DISTINCT investor_id; participants = rows for a round_id (ADR-005). |
| `startup_batches` | startup_id, batch_id | PK both |
| `startup_industries` | startup_id, industry_id, is_primary bool | PK both; partial unique `(startup_id) WHERE is_primary` |

### 4.11 Media, redirects, FX (DM-11)

- **`media_assets`** — id, `blob_prefix`, `purpose media_purpose`, `state media_state` (staging → attached on save), `variants jsonb` (`[{ width, height, url, bytes }]`), `blur_data_url`, `source_url` (nullable; where it was fetched from), `created_by`, `created_at`, `attached_at`. Variant widths — logo: 64/128/256 · cover: 640/1280/1920 · photo: 128/256/512 · og: 1200×630. All WebP.
- **`slug_redirects`** — id, `entity_type`, `old_slug`, `entity_id`, `created_at`. Unique (`entity_type`, `old_slug`). Chains are flattened on write (every old slug points at the entity, never at another old slug).
- **`fx_rates`** — `currency char(3)`, `rate_date date`, `usd_per_unit numeric(18,8)`, `source text`. PK (`currency`, `rate_date`). Imported daily from ECB reference rates (cross-computed to USD).

### 4.12 Ops tables (DM-12)

- `users`, `sessions`, `accounts`, `verifications`, `two_factors` — Better Auth schema, generated with its CLI and aligned to project conventions (timestamptz, snake_case); `users.role user_role not null default 'editor'`, `users.two_factor_enabled boolean not null`.
- **`audit_log`** — id, entity_type, entity_id, action (create/update/archive/restore/publish/unpublish/slug_change/hard_delete/erase), actor_id, `diff jsonb`, `ip inet` (nullable), created_at. The app role may only `INSERT`. **Personal-data fields** (founder `full_name`, `headline`, `bio`, links, photo; user email) are recorded as `{"field": "bio", "changed": true}` with no values. `ip` is nulled after 90 days and rows are deleted after 12 months by the `retention` role job (SEC-11).
- **`import_jobs`** — id, filename, `file_sha256`, `status import_status`, `rows jsonb` (normalized, validated rows from the dry-run), row_count, create_count, update_count, skip_count, error_count, `errors jsonb`, actor_id, created_at, `expires_at` (created_at + 24 h), `committed_at`.
- **`erasure_log`** — id, entity_type, `entity_id_hash` (SHA-256, no personal data), actor_id, erased_at. Proof an erasure happened without retaining what was erased.
- **`privacy_requests`** — id, `request_type privacy_request_type` (access/correction/erasure/objection), `status privacy_request_status` (open/completed/rejected), `subject_entity_type` (founder/user/other), `subject_entity_id` (nullable; nulled when that founder is erased), `received_at`, `due_at` (received + 30 days, set by the service), `notes` (may hold contact details — audited by name only), `resolved_at`, `resolved_by`, `created_by`, `created_at`. Check: `(status = 'open') = (resolved_at is null)`.
- **`scrub_founder_audit(uuid)`** — the only way the app role can rewrite `audit_log`: `SECURITY DEFINER` with a pinned `search_path`; refuses while the founder row exists, so it runs only inside an erasure; replaces the diff of rows about the founder or mentioning their id with `{"scrubbed": true}`, nulls `ip`, and nulls `entity_id` on the founder's own rows. EXECUTE is granted to `startupshq_app` only.

### 4.13 Functions & indexes (DM-13)

- Migration prologue: `CREATE EXTENSION pg_trgm; CREATE EXTENSION unaccent;` and `immutable_unaccent(text)` — an IMMUTABLE SQL wrapper calling `unaccent('unaccent', $1)`. **`unaccent()` itself is not IMMUTABLE and is rejected inside a generated column.**
- Check-constraint SQL must never contain `;`: drizzle-kit truncates the expression there when generating a migration, which can break it or silently weaken it. Guarded by `src/server/db/schema/schema.test.ts`.
- Unique b-tree on every `slug`; index on every FK column in every join table.
- GIN on each `search_vector`; GIN `gin_trgm_ops` on `immutable_unaccent(lower(name))` for startups, founders (`full_name`), investors.
- **Keyset indexes, one per supported sort** (FR-3xx): `startups(status, created_at DESC, id)`, `startups(status, total_raised_usd DESC NULLS LAST, id)`, `startups(status, lower(name), id)`; `funding_rounds(announced_on DESC, id)`; `funding_rounds(startup_id, announced_on DESC)`.
- Facet filters: `startups(status, stage)`, `startups(status, location_id)`.

## 5. Authorization model

### 5.1 RequestContext (SEC-03)

```ts
export type Actor = { id: string; role: 'admin' | 'editor' };
export type RequestContext =
  | { kind: 'public'; ip: string }
  | { kind: 'authed'; actor: Actor; ip: string };
```

### 5.2 PublicReadContext — cache-safe reads (SEC-03.6)

```ts
// A frozen singleton. No ip, no actor, nothing that varies per request.
export const PUBLIC_READ: PublicReadContext = Object.freeze({ kind: 'public-read' });
```

`'use cache'` derives the cache key from function arguments. Passing a per-request `ctx` (which carries `ip`) would give every visitor a distinct key — zero cache hits — and passing an `authed` ctx would store drafts in a cache shared with the public. Both are prevented structurally.

| ID | Requirement |
|---|---|
| SEC-03.1 | Every exported service function takes a context as its **first parameter**, non-optional. Omission is a compile error. |
| SEC-03.2 | Every read derives its status predicate from `visibilityFilter(ctx)`. A `public` or `public-read` ctx cannot yield a `draft` or `archived` row. |
| SEC-03.3 | Every mutation begins with `assertEditor(ctx)` (or `assertAdmin`), which type-narrows to `authed` and throws `ForbiddenError` otherwise. |
| SEC-03.4 | `publicContext()`, `authedContext()` and `PUBLIC_READ` in `src/server/auth/context.ts` are the only constructors. Absent or unverifiable identity ⟹ `public`. Fail closed. |
| SEC-03.5 | Three independent layers protect writes: `proxy.ts` (host + session gate) → `requireEditor()` in the handler → `assertEditor(ctx)` in the service. `proxy.ts` is never the sole check (cf. CVE-2025-29927, a 2025 middleware-bypass vulnerability). |
| SEC-03.6 | Functions in `src/server/cache/**` accept **only** `PublicReadContext`; their parameter types make an `authed` or per-request ctx a compile error, and a runtime guard rejects anything else. Editor previews use separate, uncached reads. |
| SEC-03.7 | Public page routes never read cookies or headers, so they stay cacheable and can never branch on identity. |

## 6. Functional requirements

Endpoint paths, parameters and DTO shapes are specified in [API.md](./API.md). This section states *what* must exist.

### 6.1 Public pages (FR-1xx) — served on the public origin

| ID | Path | Requirement |
|---|---|---|
| FR-113 | `/` | Immersive landing (ADR-023). Up to 300 most recently added published startups as `StartupCard`s from a cached in-process read (`src/server/cache/startups.ts`, registered in the authz suite), rendered first as a server-rendered grid of real links. When `prefers-reduced-motion` is not set and WebGL is available, a lazily loaded canvas (OGL) shows the same cards on a curved grid that wraps endlessly and pans by mouse, touch and wheel with inertia; the links stay in the page, visually hidden, and keyboard focus glides the canvas to the focused card. Reduced motion, no WebGL or a lost context ⟹ the flat grid, and no WebGL context is created under reduced motion. The same on phone, tablet and desktop. No blocking loader. |
| FR-101 | `/companies` | Explore grid ("Show all"; moved from `/` by ADR-023). As built (Phase 14): the page is static and prerenders the cached unfiltered first page; facets, `q` and `sort` live in the URL under the API's parameter names, serialised canonically, and every other page is fetched from `GET /api/v1/startups`, so filtered reads stay on the WAF-fronted API path (SEC-08). Facets via URL params (stage, industry, work type, city, country, batch, investor, founder, q). Sorts: recent, raised, name. Signed keyset cursor pagination, 24/page. Acquired companies excluded by default, toggleable. Card links use hover prefetch, not viewport prefetch (NFR-11). |
| FR-102 | `/companies/[slug]` | Cover + logo, name (with "(Acquired by X)"), tagline, description, meta row, founders strip, "Backed by" investor logos, batch badges, round timeline newest-first with cited sources, totals (raised, and debt shown separately when present), ≥ 6 similar companies. Unknown, draft or archived ⟹ 404. An old slug ⟹ 301 to the current slug (FR-409). As built (Phase 15): pages look the record up before rendering, so 404s are real statuses; the permanent redirect is **308** (Next.js `permanentRedirect`), equivalent for search engines, while the API answers 301. Applies to FR-103–FR-105 too. |
| FR-103 | `/founders/[slug]` | Photo or initials avatar, name, headline, bio, links, and **every** startup with role, tenure, current/past, newest-first. Same 404/301 rules. |
| FR-104 | `/investors/[slug]` | Logo, name, type, description, website, portfolio grid (paginated), rounds led, stage and industry breakdown. |
| FR-105 | `/batches/[slug]` | Program + label, dates, cohort grid, stats: company count, total raised, top 5 industries. |
| FR-106 | `/news` | Rounds newest-first grouped by date: logo, company, amount (with original currency when non-USD) or "Undisclosed", round type, date, source link. Paginated. |
| FR-107 | `/categories` | Directory of all facets with ≥ 1 published company, grouped by kind. |
| FR-108 | `/categories/{industries,stages,work-type,locations/cities,locations/countries}/[slug]` | One shared component. **404 unless the facet value exists and has ≥ 1 published company.** Copy from `taxonomy_pages` with a generated fallback for real values only. Facets with < 5 published companies render with `noindex` and are excluded from nav and sitemap. |
| FR-109 | `/search` | Ranked full-text across the four entity types, grouped; trigram fallback for misspellings. Not cached per query. |
| FR-110 | `/sitemap.xml`, `/robots.txt` | Sitemap: all published entities + indexable category pages. `robots.txt`: disallow `/api/`. |
| FR-111 | OG images | Generated **at publish/update** via `next/og`, stored as a media asset (purpose `og`), referenced in metadata by Blob URL. No per-request OG rendering. As built (Phase 9): rendered after a successful publish and after editing a live record, re-encoded to WebP 1200×630 like any other image, replacing the previous card and its blobs; a rendering failure is logged and never undoes the write. |
| FR-112 | `/about`, `/privacy` | Static. About: data sourcing, corrections and takedown policy. Privacy: what personal data is held, lawful basis, how to request access/correction/erasure/objection (SEC-18). Required at launch. |

### 6.2 Admin (FR-2xx) — served only on the admin origin

| ID | Path | Requirement |
|---|---|---|
| FR-201 | `/admin/login` | Email + password, then **TOTP 2FA (mandatory for every user)**. Enrollment forced on first login; 10 single-use recovery codes. Generic error text. Password reset by email. |
| FR-202 | `/admin` | Counts per entity, draft queue, 20 most recent audit entries, pending import jobs. |
| FR-203 | `/admin/{entity}` | Paginated, searchable list; status filter (draft/published/archived); bulk publish; archive and restore. Entities: startups, founders, investors, batches, rounds. |
| FR-204 | `/admin/startups/new`, `/admin/startups/[id]/edit` | Sectioned form: basics, media, classification, location, founders, investors, batches, rounds. Comboboxes link existing records or create drafts inline. Save-draft and Publish are distinct actions. |
| FR-205 | `/admin/categories` | Edit `taxonomy_pages` copy for existing facet values only. |
| FR-206 | `/admin/import` | Upload CSV → dry-run table → commit within 24 h. |
| FR-207 | `/admin/media` | Asset browser; shows staging vs attached. |
| FR-208 | `/admin/users` | Admin-only: invite by email, change role, reset a user's 2FA, deactivate. As built (Phase 8c): an invite creates the account with an unusable random password and sends the password-reset link worded as an invite (valid one hour, re-sent while the invitee has not enrolled); `users.deactivated_at` switches an account off, refused at sign-in with the same answer a wrong password gets, and reactivation is available; an admin can neither demote nor deactivate themselves. |
| FR-209 | Slug change | Admin-only action on any entity's edit screen; writes `slug_redirects` (FR-409). |
| FR-210 | `/admin/privacy` | Admin-only: record a privacy request, run founder erasure (FR-410). |

### 6.3 API (FR-3xx)

- Base `/api/v1`. JSON. Full contract in [API.md](./API.md).
- **Reads** are served on the public origin with no credentials and use `PublicReadContext` or `publicContext()`.
- **Writes** are served **only** on the admin origin; the same paths on the public origin return 404 (ADR-014).
- Pagination: opaque, **HMAC-signed** keyset cursor encoding `(sort, sort-key value, id)` — never `OFFSET`. A cursor minted for one sort is rejected for another. Anonymous callers may page at most 20 pages deep per listing (SEC-15).
- `/suggest` p95 ≤ 150 ms (NFR-01).

### 6.4 Editorial features (FR-4xx)

| ID | Requirement |
|---|---|
| FR-401 | **Prefill:** given a URL, return a draft object from OG tags, JSON-LD, `<title>`/meta and apple-touch-icon/favicon. As built (Phase 10): the careers link is taken from the company's own host, or from a recognised hiring platform (Greenhouse, Lever, Ashby and similar), never from a third party's careers page — an acquired company links its parent's, which is not its own hiring page. `services/prefill.ts` parses with `cheerio` (no script execution), reads JSON-LD `Organization` including inside `@graph`, resolves relative URLs against the page's final URL and keeps only https; fetched images go through the media pipeline as `staging` assets carrying `source_url`; the fetcher and the Firecrawl call are injectable, so the SEC-05 matrix is exercised without a socket. **Every** fetch — page, `og:image`, icons, Firecrawl-returned URLs — goes through `safeFetch` (SEC-05). Fetched images are stored as `staging` media assets. All fields editable; never persisted as an entity, never published. Degrades to a partial result rather than failing. |
| FR-402 | **CSV import:** dry-run mandatory. The dry-run stores normalized rows (`import_jobs.rows`) and the file's SHA-256; commit applies **those stored rows** (no re-upload), within 24 h. Commit **re-validates against current DB state inside the transaction** and aborts with a conflict if anything changed since the dry-run. Duplicate detection: exact slug, then trigram similarity > 0.85. Measured on real pairs (2026-09-16): the threshold catches case, spacing and word-order variants (`analytics kiln` scores 1.00 against `kiln analytics`) and `Kiln Analytics AI` at 0.88, but **not** suffix variants such as `Kiln Analytics Inc` (0.79) or a single dropped letter (`Kiln Analytic`, 0.81) — those arrive as `create` rows for an editor to catch. Lowering the threshold would trade missed duplicates for skipped legitimate rows; a skip is recoverable by re-running with an explicit slug. `;`-separated founder/investor names resolve to existing records or become drafts. Max 1,000 rows. Values are stored raw. |
| FR-403 | **Slugs:** generated from name (Unicode NFKD with diacritics stripped, lowercase ASCII, hyphenated, ≤ 80 chars — `src/lib/slug.ts`), uniqueness-checked with a numeric suffix. A name with no Latin letters or digits (e.g. `株式会社`) yields no slug, so the editor must type one; nothing is ever transliterated silently. Editors cannot change a published slug; admins can (FR-409). |
| FR-404 | **Derived fields:** `total_raised_usd`, `total_debt_usd`, `latest_round_id` recomputed inside the same transaction as any round insert/update/archive/delete. Grants and secondaries are shown in the timeline and excluded from totals. Only **published** rounds count: totals are public, so a draft or archived round would leak its amount. Implemented once, in `src/server/db/derived.ts`. |
| FR-405 | **Audit:** every mutation writes an `audit_log` row inside its transaction, with personal-data fields recorded by name only (DM-12). |
| FR-406 | **FX conversion:** editors enter `currency` + `amount_original`; the server computes `amount_usd` from `fx_rates` using the rate on `announced_on` or the latest prior date with a rate — never a later one, and never more than 7 days older (otherwise the save is refused with 422) — and stores `fx_rate`, `fx_rate_date`, `fx_source = 'ecb'`. A currency ECB does not publish requires an admin-entered rate with `fx_source = 'manual'` and a source note. |
| FR-407 | **Deletion is archiving.** DELETE on an entity sets `status = archived`, `archived_at`; publicly it 404s; it can be restored. Hard delete is admin-only and permitted only when `first_published_at is null`. |
| FR-408 | **Media:** uploads are sniffed, pixel-limited and re-encoded (SEC-06), stored as pre-generated WebP variants, created in `staging` and marked `attached` when an entity referencing them is saved. A scheduled job deletes staging assets older than 24 h and unreferenced attached assets older than 7 days. As built (Phase 9): `services/media.ts` with storage in `lib/blob.ts` (in-memory outside production, so no test reaches the network); the sweep lives in `db/media-gc.ts` behind `pnpm media:gc` and `maintenance.yml`, and every branch of it also proves no record references the asset, since deleting a referenced image would blank it. |
| FR-409 | **Slug redirects:** an admin slug change inserts the old slug into `slug_redirects` and flattens chains. Public pages and API reads for an old slug return 301 to the current one. |
| FR-410 | **Founder erasure (privacy):** admin-only. Removes the founder, their join rows and media, scrubs `audit_log` rows referencing the entity, invalidates caches, adds an `erasure_log` entry. Irreversible; requires typed confirmation. |

## 7. Security requirements

| ID | Requirement | Verified by |
|---|---|---|
| SEC-01 | No DB access or secret reachable from client code: `server-only` on every `src/server/**` file; `DATABASE_URL` read only in `src/server/db/client.ts`; no `NEXT_PUBLIC_` secret. Node tooling that loads server modules outside Next.js (drizzle-kit, Vitest, scripts) runs with the `react-server` export condition, so the guard is never removed to make tooling work. | `check-bundle-leak.ts` scans client chunks for the **values** of server secrets (injected in CI) and for connection-string patterns (`postgres(ql)?://`) |
| SEC-02 | All input Zod-validated at the API boundary, re-validated server-side; unknown body fields rejected. All queries parameterized via Drizzle. | Contract tests |
| SEC-03 | Data-layer authorization per §5, including cache-safe public reads (SEC-03.6, SEC-03.7). | Authz conformance suite |
| SEC-04 | **Sessions & CSRF.** Rotation on privilege change is implemented in the users service (Phase 8c): a role change, a two-factor reset and a deactivation each delete that user's session rows, so the next request signs in again. Session cookie is host-only on the admin origin (no `Domain` attribute), httpOnly, `Secure`, `SameSite=Lax`, **`__Host-` prefix** (`__Host-startupshq.session_token`). Phase 6 spike, 2026-09-15: Better Auth only emits `__Secure-` itself, so its prefix is disabled and the cookie is named `__Host-…` explicitly, with `Secure`, `Path=/` and no `Domain`; sessions validate with it end to end (`src/server/auth/auth-flow.test.ts`). Plain `startupshq.*` names are used only on http in local development. Sessions are stored in Postgres, never in Redis. Rotation on privilege change; server-side revocation. **Mandatory TOTP 2FA** for all users. **CSRF:** the shared handler wrapper rejects every non-GET request whose `Origin` is not the admin origin (fallback: `Sec-Fetch-Site: same-origin`), and JSON routes require `Content-Type: application/json`. Better Auth's own origin checks cover its auth routes only. | e2e + contract tests |
| SEC-05 | **SSRF.** Every server-side fetch of a URL not authored by us uses `safeFetch`: `https` only; the IP is validated **at connect time on the actual socket** (defeats DNS rebinding) against loopback, private (10/8, 172.16/12, 192.168/16), link-local (169.254/16 incl. `169.254.169.254`), CGNAT (100.64/10), `0.0.0.0/8`, IPv6 `::1`, `fc00::/7`, `fe80::/10` and IPv4-mapped IPv6; redirects handled manually and re-validated, max 3; 5 s timeout; 5 MB cap. An IPv4 address carried inside IPv6 is judged by what it embeds — both IPv4-mapped (`::ffff:`) and the **NAT64 well-known prefix `64:ff9b::/96`**, which resolvers synthesise for IPv4-only hosts. The socket is handed **only the validated public addresses** of an answer and the hostname is refused when none survive, rather than refusing any answer that merely contains a non-public address: dual-stack and DNS64 resolvers mix them constantly, and safety comes from never handing a non-public address to the socket, not from the answer being uniformly clean (both corrected 2026-09-16, after real sites were refused). Applies to the pasted page **and** every image/icon URL it references **and** URLs returned by Firecrawl. Editor-only, rate-limited. | Unit + contract tests incl. rebinding mock |
| SEC-06 | **Uploads.** MIME sniffed from magic bytes; allowlist jpg/png/webp — **SVG refused** (tightened 2026-09-16: every upload is rasterised anyway, so accepting SVG would add an XML parser, historically the most exploited path in image libraries, for no product gain; editors export PNG and prefill falls back to a site's raster icon); 5 MB byte cap; sharp `limitInputPixels` = 24 MP (decompression-bomb guard) and `failOn: 'error'`; SVG rasterized at a capped density with external references disallowed; output dimensions capped; re-encoded to WebP (strips EXIF and embedded payloads); random Blob prefixes. | Unit tests |
| SEC-07 | **CSV.** Row cap; per-field Zod; mandatory dry-run; stored rows + SHA-256; commit re-validation in one transaction; 24 h expiry. Formula-prefix neutralization (`= + - @`, tab, CR) is applied **on CSV export only** — stored values stay raw. | Unit tests |
| SEC-08 | **Rate limiting.** Edge: Vercel WAF rules on `/api/v1/*` keyed on IP and JA4, with a bot challenge on list endpoints — blocked traffic never reaches a function. App (Upstash): login — hard limit 20 attempts / 15 min per IP, plus progressive delay per email after 5 failures (1 s doubling to 30 s), **no account lockout**; prefill — 20 / hour per user. Better Auth's limiter uses Upstash as shared storage (in-memory limits do not work across serverless instances). Failure mode: login and prefill **fail closed**; public reads rely on WAF only. Implementation (Phase 6): our limiter counts sign-in and second-factor attempts per IP and delays per account, keyed by a SHA-256 of the email so no address is stored; a store failure refuses with `429` and `Retry-After: 60`. Better Auth's own limiter also runs, with the same store as its custom storage (its default: 3 sign-in attempts per 10 s per IP). The two-factor plugin's account lockout is disabled. Because sessions stay in Postgres, a store outage blocks new sign-ins but signs no one out. Locally and in CI the store is Redis behind serverless-redis-http (`docker-compose.yml`), so the same client and failure path run everywhere. Phase 8 adds a **per-account write budget** of 120 writes per minute, keyed by the staff account id: only staff hold accounts, so it bounds what one stolen editor session can do, and it **fails open** — a limiter outage logs and allows the write rather than halting editorial work, which the audit log still records. | Integration tests + WAF config review |
| SEC-09 | **Headers & CSP.** Admin origin: nonce-based strict CSP (`script-src 'nonce-…' 'strict-dynamic'`), rendered dynamically. Public origin: statically cacheable, so no nonce. Next.js `experimental.sri: { algorithm: 'sha256' }` stamps `integrity` on every script **file** it emits, but every page also carries **inline** scripts holding its React payload, which neither SRI nor a static hash list can cover. The public policy is therefore ADR-014's fallback, **as built 2026-09-16 (ADR-022): `script-src 'self' 'unsafe-inline'`**, still enforcing `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, `connect-src 'self'` and `img-src 'self' data: <blob host>` — acceptable because no credential is valid on the public origin (ADR-014). The Phase 12 policy without `'unsafe-inline'` blocked hydration of every public page; found in Phase 13 by loading a production build in a browser. Built in `src/lib/security-headers.ts`, applied by `src/proxy.ts`, which is the only place that knows which host answered. Inline **styles** are allowed on both origins, because Next.js inlines the stylesheet and a nonce cannot cover a cached page. Both origins: HSTS `max-age=31536000; includeSubDomains` (**preload only post-launch**, SEC-19), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, minimal Permissions-Policy. | Header assertion tests |
| SEC-10 | **DB roles.** Verified 2026-09-16 by `src/server/db/roles.test.ts`, which connects as each role rather than reading the migration. Migrations create NOLOGIN group roles and default privileges; each environment creates its own LOGIN users (passwords never in git) and grants membership. `startupshq_app` (app_rw): DML on content tables, INSERT/SELECT only on `audit_log` and `erasure_log`, no DDL. `migrator`: DDL, used **only** by the GitHub Actions migration workflow in a protected environment — never present in Vercel. `startupshq_retention`: SELECT/UPDATE/DELETE on `audit_log` only. `startupshq_backup`: read-only. TLS via the Neon pooler. | Test: DDL as `app_rw` → permission denied |
| SEC-11 | **Audit.** Append-only for the app; personal-data fields recorded by name only; `ip` nulled after 90 days; rows deleted after 12 months by the `retention` job. | Unit + retention job test |
| SEC-12 | Error responses never leak stack traces, SQL, table names or internal ids. Verified 2026-09-16 by `src/server/lib/error-shape.test.ts`, including a driver error carrying a query, its parameters and a constraint name. Server logs and Sentry carry detail, with PII scrubbing. | Unit tests |
| SEC-13 | **Supply chain.** Guarded from 2026-09-16 by `scripts/supply-chain.test.ts`, which fails if a dependency build script is allowed, the release-age floor drops, an action loses its commit pin, a workflow drops `permissions`, or an install stops being frozen. `pnpm install --frozen-lockfile` in CI. In `pnpm-workspace.yaml`: `strictDepBuilds: true` (pnpm default — install fails on unreviewed dependency build scripts) with every dependency build script explicitly reviewed in `allowBuilds` (currently `esbuild`, `sharp` and `unrs-resolver`, all denied because they ship prebuilt binaries; `onlyBuiltDependencies` is deprecated since pnpm 11); `dangerouslyAllowAllBuilds: false`; `minimumReleaseAge: 4320` (minutes = 3 days; pnpm's default is 1440) with `minimumReleaseAgeExclude` only for audited exceptions. a weekly scheduled `pnpm audit` workflow covers the full lockfile, because GitHub's dependency graph and Dependabot do not support pnpm 12 lockfiles (verified 2026-09-14: only direct dependencies are graphed and lockfile updates fail); npm version updates are a monthly manual review (decided 2026-09-14); the CI `pnpm audit` gate fails on high severity **except** listed advisories with an owner and expiry date. | CI + config review |
| SEC-14 | **Client IP** is taken only from the platform's trusted source (`ipAddress()` from `@vercel/functions`), in one helper. `X-Forwarded-For` supplied by clients is never trusted. | Unit test |
| SEC-15 | **Anti-scraping.** Signed cursors; max 20-page depth for anonymous pagination; `limit` ≤ 48; public DTOs contain only fields the UI renders; WAF bot challenge (SEC-08); `robots.txt` disallows `/api/`; a private list of watermark phrasings in a few published descriptions (factually correct wording — never fake records, per PRD principle 5) to detect bulk copies. | Contract tests + review |
| SEC-16 | **Deploy isolation.** Preview deployments use a Neon branch created from a **seed-data branch**, never from production; Vercel Authentication is enabled on previews; production secrets are scoped to the Production environment only. Migrations never run in the Vercel build step (ADR-015). | Deployment checklist |
| SEC-17 | **Backups.** Neon point-in-time restore ≥ 7 days (Launch plan) in production; nightly `pg_dump` by `backup_ro`, encrypted with `age`, uploaded to Cloudflare R2 with 30-day lifecycle; monthly automated restore test into a scratch branch comparing row counts; failure alerts. | `restore-test.yml` |
| SEC-18 | **Personal data.** `/privacy` notice at launch; requests (access, correction, erasure, objection) handled within 30 days via a published email address and `/admin/privacy`; erasure per FR-410; founder photos only when founder-supplied or licensed — otherwise initials avatar; `startup_founders.source_url` records where each attribution came from. Reviewed by legal counsel before launch. | Launch checklist |
| SEC-19 | **HSTS preload** is enabled only after ≥ 3 months of stable HTTPS on every subdomain (preload removal takes months). | Post-launch checklist |
| SEC-20 | **Public repository hygiene** (ADR-021). No security property depends on the code, schema or docs being secret. GitHub secret scanning and push protection on; Dependabot alerts and security updates on; branch protection on `main` requiring CI; Actions restricted to GitHub-owned and verified actions, every `uses:` pinned to a full commit SHA; every workflow declares `permissions:` (default `contents: read`); fork pull request workflows require approval and never receive secrets; `pull_request_target` is never used; migrator/backup/retention/R2 secrets exist only as environment secrets in a `production` environment with a required reviewer; private operational material (watermark list, real `.env` values, backups, legal correspondence) is never committed; `SECURITY.md` points to GitHub private vulnerability reporting. | Repo settings check + workflow lint |

## 8. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-01 | **Performance:** LCP ≤ 2.0 s p75 mobile; TTFB ≤ 400 ms for a cached page; `/suggest` p95 ≤ 150 ms; company page ≤ 3 SQL round-trips on a cache miss. |
| NFR-02 | **Caching (Next.js 16):** public reads are `'use cache'` functions in `src/server/cache/**` taking only `PublicReadContext`, tagged via `cacheTag` with tags from `cache-tags.ts`. Mutations call `revalidateTag(tag, { expire: 0 })` for every affected tag (immediate expiry, valid in route handlers). The deprecated single-argument `revalidateTag(tag)` and `unstable_cache` are not used. Search and suggest are not cached per query. Stale content after a publish is a bug. |
| NFR-03 | **SEO:** every indexable public page server-rendered with unique `<title>`, description, canonical, OG/Twitter tags (OG image from Blob, FR-111); JSON-LD `Organization` on companies, `Person` on founders; sitemap regenerated on publish. `noindex` is applied only to thin facet pages (FR-108) and to non-content routes. |
| NFR-04 | **Accessibility:** WCAG 2.1 AA — keyboard reachable, visible focus, ≥ 4.5:1 contrast in both themes, alt text on every image (initials avatars labelled), labelled controls, ARIA on comboboxes. |
| NFR-05 | **Responsive:** 360 px to 2560 px, no horizontal body scroll. |
| NFR-06 | **Theming:** light/dark via CSS custom properties; respects `prefers-color-scheme`; explicit toggle persists per viewer. As built (Phase 13): **dark is the default**; the toggle offers dark, light and "system", which follows `prefers-color-scheme`; the choice lives in `localStorage` and an inline script applies it before paint, so public pages stay static. |
| NFR-07 | **Observability:** Sentry live before launch (PII scrubbing on); structured logs with request id. Vercel retains runtime logs only 1 h (Hobby) / 1 day (Pro), so Sentry is the incident record. |
| NFR-08 | **Data integrity:** money as `bigint` whole USD, never float; FX recorded per round; multi-table writes transactional; FK and check constraints enforced in the DB. |
| NFR-09 | **Browsers:** Chrome/Edge/Firefox 111+, Safari 16.4+ (Next.js 16 baseline); iOS Safari 17+. |
| NFR-10 | **Test coverage:** ≥ 80% lines on `src/server/services`; 100% of mutation functions and 100% of `src/server/cache/**` functions in the authz conformance suite. |
| NFR-11 | **Cost controls:** Vercel image-optimizer transformations = 0 (`images.unoptimized` for Blob assets; variants pre-generated); dense link grids use hover prefetch only; OG images pre-rendered; WAF blocks abusive traffic before compute; Upstash used only for low-volume limits; spend management / budget alerts at 50 / 80 / 100 % on Vercel, Neon and Upstash; monthly cost review. |
| NFR-12 | **Hosting tiers:** development may use free tiers. **Public launch requires** Vercel Pro (Hobby is non-commercial only) and Neon Launch (7-day restore, SEC-17). Neon scale-to-zero stays enabled — caching keeps the DB idle, and a rare cold start is cheaper than always-on compute. |

## 9. Environments

**Vercel environment variables**

| Variable | Purpose | Scope |
|---|---|---|
| `DATABASE_URL` | Postgres, `app_rw` role (DML only) | Production · Preview (preview branch) · local |
| `TEST_DATABASE_URL` | Vitest integration database | local · CI only (not Vercel) |
| `BETTER_AUTH_SECRET` | session signing | per environment |
| `BETTER_AUTH_URL` | = admin origin | per environment |
| `NEXT_PUBLIC_SITE_URL` | public origin (non-secret) | all |
| `ADMIN_ORIGIN` | admin origin, used by origin checks | all |
| `CURSOR_SIGNING_SECRET` | HMAC key for cursors | per environment |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob | per environment |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | login + prefill limits, Better Auth limiter | Production · Preview |
| `EMAIL_API_KEY`, `EMAIL_FROM` | transactional email | Production · Preview |
| `SENTRY_DSN` | error monitoring | Production · Preview |
| `FIRECRAWL_API_KEY` | prefill fallback | optional |

**GitHub Actions secrets (never in Vercel)**

`MIGRATION_DATABASE_URL` (migrator, protected `production` environment) · `BACKUP_DATABASE_URL` (`backup_ro`) · `RETENTION_DATABASE_URL` (`retention`) · `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` · `BACKUP_AGE_RECIPIENT` (public key; the private key is kept offline).

**Environments:** **local** (Docker Postgres, `pnpm dev`, both origins via `localhost` and `admin.localhost`) · **preview** (Vercel per PR, Neon branch from the seed-data branch, Vercel Authentication on) · **production** (Vercel Pro + Neon Launch). Migrations run from `migrate.yml` on merge to `main`, before the production deployment is promoted, and must be backward-compatible with the currently deployed code (expand → deploy → contract).

## 10. Acceptance criteria (v1 ships when)

1. All `FR-1xx` public pages render correctly from seeded data; the PRD §8 traversal completes with no dead ends; old slugs 301.
2. All `FR-2xx` admin screens work on the admin origin only; drafts and archived records are invisible publicly (verified by test).
3. `SEC-01` … `SEC-18` and `SEC-20` satisfied, each with its named verification passing (SEC-19 is post-launch).
4. Authz conformance suite covers every mutation and every cached public read; service-layer coverage ≥ 80%.
5. Playwright graph-traversal, admin-CRUD, 2FA, CSRF and access-control specs green.
6. Lighthouse ≥ 95 performance / 100 SEO on a company page; LCP ≤ 2.0 s p75 mobile; image transformations = 0.
7. Prefill rejects every hostile URL in `SEC-05`, including rebinding and hostile `og:image`; CSV commit rejects a changed dataset.
8. A backup has been restored successfully from R2; budget alerts are configured; production runs on Vercel Pro + Neon Launch.
9. `/about` and `/privacy` are live and legally reviewed.
10. ≥ 300 companies published, ≥ 1.5 founders each, ≥ 80% with a cited round, across ≥ 12 countries.

---

**See also:** [PRD.md](./PRD.md) · [API.md](./API.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [TEST_PLAN.md](./TEST_PLAN.md) · [../TODO.md](../TODO.md)
