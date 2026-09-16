# startupsHQ — Architecture

**Status:** Draft v2 · **Last updated:** 2026-09-16 · Companion to [PRD.md](./PRD.md) and [SRS.md](./SRS.md)

PRD says *what* and *why*. SRS says *what exactly*. This document says **how the system is put together and why** — including the alternatives we rejected, so a future change is a conscious revision rather than an accident.

> **v2 (2026-09-14):** revised after a review against current Next.js 16, Vercel, Neon, Upstash and Better Auth documentation. New decisions are recorded as ADR-012 … ADR-020; the accepted ADRs they refine or amend are marked, never rewritten.

---

## 1. System context

```
   ┌────────────┐     ┌────────────┐     ┌────────────┐
   │  Visitor   │     │   Editor   │     │ Googlebot  │
   └─────┬──────┘     └─────┬──────┘     └─────┬──────┘
         │ startupshq.space │ admin.startupshq.space
         └────────┬─────────┴──────────────────┘
                  ▼
        ┌───────────────────────┐
        │ Vercel WAF (edge)     │  rate limits · bot challenge
        └──────────┬────────────┘
                   ▼
        ┌───────────────────────┐        ┌────────────────────────┐
        │ startupsHQ on Vercel  │───────▶│ Sentry (errors)        │
        │ Next.js 16 monolith   │───────▶│ Email provider         │
        └──┬─────────┬───────┬──┘        └────────────────────────┘
           │         │       │
           ▼         ▼       ▼
     ┌─────────┐ ┌───────┐ ┌──────────────┐   ┌──────────────┐
     │  Neon   │ │ Blob  │ │ Upstash      │   │ Firecrawl    │
     │Postgres │ │images │ │login/prefill │   │ prefill only │
     └────┬────┘ └───────┘ └──────────────┘   └──────────────┘
          │
   ┌──────▼─────────────────────────────┐    ┌──────────────────┐
   │ GitHub Actions: migrate · backup · │───▶│ Cloudflare R2    │
   │ restore-test · retention · GC · FX │    │ encrypted dumps  │
   └────────────────────────────────────┘    └──────────────────┘
```

**Degradation, stated honestly:**

| Outage | Effect |
|---|---|
| Neon | Cached pages keep serving; cache misses, search and all admin work fail |
| Upstash | Login and prefill **fail closed** (unavailable). Browsing and search unaffected — public rate limiting is at the WAF |
| Blob | Images fail to load; pages still render with blur placeholders and initials |
| Firecrawl | Prefill degrades to plain fetch |
| Email provider | Invites and password resets fail; existing sessions unaffected |
| Sentry | No error reports; app unaffected |

## 2. Origins & layering

### 2.1 Two origins, one deployment (ADR-014)

| Origin | Serves | Credentials |
|---|---|---|
| `startupshq.space` | Public pages, read API, sitemap | **None are ever valid here** |
| `admin.startupshq.space` | Admin UI, write API, auth routes | Host-only session cookie + mandatory 2FA |

`proxy.ts` routes by host: `/admin/*`, `/api/auth/*` and every non-GET `/api/v1/*` return 404 on the public host. Because no session is valid on the public origin, a script injected into a public page has nothing to steal and no session to ride.

### 2.2 Layering

```
  ┌─ src/app/(public)/ · src/app/admin/ · src/components/ · src/hooks/ · src/lib/
  │     UI. MAY NOT import from src/server/**. Public routes never read cookies.
  ├─ src/proxy.ts
  │     Host routing and the /admin session gate (layer 1 of 3, never the only one).
  ├─ src/app/api/v1/
  │     HTTP boundary: trusted IP → origin check → Zod → ctx → authz → service → DTO.
  ├─ src/server/cache/
  │     'use cache' public reads. Accept ONLY PublicReadContext.
  ├─ src/server/services/
  │     Business logic. ctx-first. The only callers of the DB.
  ├─ src/server/{auth,validation,dto,lib}/
  │     RequestContext, guards, visibility, Zod, mappers, slug/money/fx/cursor/ip/safe-fetch.
  └─ src/server/db/
        Drizzle schema + the single module that reads DATABASE_URL.
```

**Dependency rule: imports point downward only.** `server-only` at the top of every `src/server/**` file makes a violation a build error; `check-bundle-leak.ts` re-scans the built client bundle for secret values in CI (SEC-01). Conventions decay under deadline; build errors don't.

## 3. Request lifecycles

### 3.1 Public page — cached (ADR-013)

```
GET startupshq.space/companies/highstock
  │
  ├─ WAF ................................ allowed
  ├─ proxy.ts ........................... public host, not /admin → pass
  ├─ page.tsx (Server Component) ........ reads no cookies, no headers
  │    └─ getStartupPage(PUBLIC_READ, "highstock")      ← src/server/cache/
  │         'use cache'
  │         cacheTag("startup:highstock")
  │         ├─ cache HIT  → return (0 DB queries)
  │         └─ cache MISS → startupService.getBySlug(PUBLIC_READ, slug)
  │                           ├─ visibilityFilter → status = 'published'
  │                           ├─ query 1: startup + location + industries + latest round
  │                           ├─ query 2: founders via startup_founders
  │                           └─ query 3: investors via investments + rounds
  │                         → toStartupDTO(row)
  └─ HTML. Old slug? → 301 to the current slug via slug_redirects.
```

`PUBLIC_READ` is a frozen singleton with no `ip` and no actor, so **every visitor shares one cache key** — the cache actually hits, and DB load scales with edits, not visitors. An editor's identity can never reach this path, so a draft can never enter the shared cache.

### 3.2 Client-side fetch — filters, load-more, ⌘K

```
Browser ── GET startupshq.space/api/v1/startups?stage=seed&cursor=… 
   ├─ WAF: IP + JA4 rate rule, bot challenge on list endpoints ── 429 here costs no function
   └─ route handler
        ├─ Zod parse; verify cursor HMAC and that it matches ?sort
        ├─ anonymous depth ≤ 20 pages
        ├─ publicContext(ipAddress(req))      ← trusted IP only (SEC-14)
        └─ startupService.list(ctx, …) → DTO[] (UI fields only)
```

Search and suggest follow the same path and are **not** cached per query — caching arbitrary query strings would let anyone mint unbounded cache entries.

### 3.3 Admin mutation — three authorization layers

```
POST admin.startupshq.space/api/v1/startups
  ├─ proxy.ts ........................... layer 1: admin host + session present
  ├─ handler wrapper
  │    ├─ Origin == ADMIN_ORIGIN (or Sec-Fetch-Site: same-origin) — else 403 (CSRF)
  │    ├─ Content-Type: application/json — else 415
  │    ├─ requireEditor() ............... layer 2: valid session, 2FA satisfied, role
  │    ├─ Zod validate body
  │    └─ authedContext(actor, ipAddress(req))
  └─ startupService.create(ctx, input)
       ├─ assertEditor(ctx) ............. layer 3: survives a handler that forgets layer 2
       └─ transaction:
            ├─ insert startup (draft)
            ├─ insert joins; attach staged media assets
            ├─ convert non-USD rounds via fx_rates
            ├─ recompute total_raised_usd, total_debt_usd, latest_round_id
            └─ insert audit_log (personal fields by name only)
       └─ revalidateTag(tag, { expire: 0 }) for every affected tag
```

`{ expire: 0 }` expires the entry immediately; the next visitor gets a fresh render. The Next.js 16 `updateTag()` alternative is Server-Actions-only, and the single-argument `revalidateTag(tag)` is deprecated.

### 3.4 Outbound fetch — prefill (SEC-05)

```
POST /api/v1/prefill { url }
  └─ safeFetch(url)
       ├─ https only
       ├─ undici connect hook: resolve → validate the ACTUAL socket IP → connect
       │     (check and connect use the same resolution — defeats DNS rebinding)
       ├─ redirect: manual; each hop re-enters safeFetch; max 3
       └─ 5 s timeout · 5 MB cap
  └─ parse OG / JSON-LD / meta
  └─ for og:image, icons, Firecrawl-returned URLs → safeFetch AGAIN (attacker-chosen URLs)
  └─ sharp (24 MP pixel limit) → WebP variants → Blob, media_assets.state = 'staging'
```

The second arrow is the one most implementations miss: the page is only the first attacker-controlled URL.

## 4. The graph — query patterns

| Traversal | Path | Shape |
|---|---|---|
| Startup → founders | `startup_founders` | One set query ordered by `sort_order` |
| Founder → startups | `startup_founders` reversed | One set query, `joined_year DESC` — **the differentiating query; keep it fast** |
| Startup → investors | `investments`, `DISTINCT investor_id` | One query; "Backed by" |
| Investor → portfolio | `investments` reversed | Signed keyset pagination |
| Round → participants | `investments WHERE round_id` | Joined into the timeline query |
| Startup ↔ batch | `startup_batches` | Many-to-many both directions |

Every column is indexed (DM-13). `investments` uniqueness uses `NULLS NOT DISTINCT` so a backer with an unknown round cannot be duplicated (ADR-005).

## 5. Caching & invalidation (ADR-013)

| Content | Mechanism | Invalidation |
|---|---|---|
| Entity & category pages | `'use cache'` in `src/server/cache/**`, `PublicReadContext` only, `cacheTag` | `revalidateTag(tag, { expire: 0 })` on write |
| Sitemap, batch stats | `'use cache'` + `cacheLife('hours')` | `revalidateTag(tag, 'max')` — slight staleness acceptable |
| Search, suggest | **Not cached** per query | — |
| Images | Blob CDN, immutable URLs per variant | New asset ⇒ new URL |
| OG images | Pre-rendered at publish into Blob | Re-rendered on update |
| Admin pages | Dynamic, uncached | — |

- Tags are built **only** in `src/server/lib/cache-tags.ts`.
- A mutation invalidates neighbours too: editing a founder invalidates `founder:{slug}` and `startup:{slug}` for each linked startup.
- Fan-out is bounded by design: editing an investor linked to 200 companies expires 200 entries, which are re-rendered lazily as they are visited — not all at once.

## 6. Derived data & money

| Column | Derivation | Owner |
|---|---|---|
| `startups.total_raised_usd` | Σ `amount_usd` of **published** rounds where `round_class` ∈ {equity, convertible} | rounds service via `src/server/db/derived.ts`, same transaction |
| `startups.total_debt_usd` | Σ `amount_usd` of **published** rounds where `round_class` = debt | rounds service |
| `startups.latest_round_id` | latest **published** equity/convertible round by `announced_on` | rounds service |
| `funding_rounds.amount_usd` | `amount_original × fx_rate` for the rate on or before `announced_on` | rounds service via `fx_rates` |

Grants and secondaries appear in the timeline but never in totals — a secondary sale moves existing shares and puts no new money into the company. Draft and archived rounds never count either: totals are public, so including an unpublished round would leak its amount. Only the service owning a source table writes its derived columns; `scripts/recompute-derived.ts` repairs them safely at any time (ADR-009, ADR-018).

## 7. Error handling

```
service throws typed error ──▶ handler maps to status ──▶ { error: { code, message } }
  ForbiddenError    → 403        Sentry + server log keep the detail (PII-scrubbed).
  UnauthorizedError → 401        The response never carries a stack trace,
  NotFoundError     → 404        SQL fragment, table name or internal id (SEC-12).
  ConflictError     → 409
  ValidationError   → 400 + field details
  anything else     → 500 "Something went wrong"
```

## 8. Deployment & operations topology

| Environment | App | Database | Migrations | Protection |
|---|---|---|---|---|
| local | `pnpm dev` (localhost + admin.localhost) | Docker Postgres 17 | `pnpm db:migrate` | — |
| preview | Vercel per PR | Neon branch **from the seed-data branch** | GitHub Actions on the preview branch | Vercel Authentication |
| production | Vercel **Pro** | Neon **Launch**, pooled, TLS | `migrate.yml` on merge to `main`, protected environment, before promotion | WAF, 2FA, spend alerts |

**Scheduled jobs (GitHub Actions)**

| Job | Schedule | Role | Purpose |
|---|---|---|---|
| `backup.yml` | nightly 02:00 UTC | `backup_ro` | `pg_dump -Fc` → `age` encrypt → R2, 30-day lifecycle |
| `restore-test.yml` | monthly | scratch branch | restore latest dump, compare row counts, alert on mismatch |
| `maintenance.yml` → retention | weekly, Mon 03:17 UTC | `retention` | null `audit_log.ip` > 90 days, delete rows > 12 months (`pnpm audit:retention`) |
| `maintenance.yml` → media GC | weekly, Mon 03:17 UTC | `app_rw` | delete staging assets > 24 h, unreferenced assets > 7 days (`pnpm media:gc`) |
| `maintenance.yml` → FX | weekdays 16:20 UTC | `app_rw` | import ECB reference rates into `fx_rates` (`pnpm fx:import`) |

Both cron entries fire the whole workflow, so each job names the schedule it belongs to. Every job
is inert until the `ENABLE_MAINTENANCE` repository variable is set in Phase 22, and each is
idempotent: re-running one changes nothing it has already done.

**WAF rules (SEC-08), to apply in Phase 22**

Written here rather than discovered during a launch. Thresholds are opening positions, tuned from
real traffic once there is some; the shape matters more than the numbers.

| Rule | Match | Action | Why |
|---|---|---|---|
| Read flood | `GET /api/v1/*`, > 300 requests / minute per IP + JA4 | rate limit, then challenge | The public API is the only surface a scraper wants; the app-level budget deliberately does not cover reads (ADR-017) |
| List scraping | `GET /api/v1/startups`, `/rounds`, `/categories`, `/search`, `/suggest`, > 60 / minute per IP + JA4 | bot challenge | Catalogue pages are the valuable ones; signed cursors and the 20-page depth cap (SEC-15) already bound how deep one caller can go |
| Admin surface | any request to `admin.startupshq.space` from outside expected geographies or from a datacentre ASN | challenge | Only a handful of people ever sign in; a challenge costs them nothing and removes credential stuffing traffic before it reaches a function |
| Auth endpoints | `POST /api/auth/*`, > 30 / 15 minutes per IP | rate limit | Second line in front of the app's own limiter, which fails closed (SEC-08) |
| Write endpoints | non-`GET` `/api/v1/*` on the public origin | block | `proxy.ts` already answers 404; blocking at the edge means the function is never woken |
| Known-bad paths | `/wp-admin`, `/.env`, `/.git/*`, `/phpmyadmin` | block | Pure noise, and each one otherwise costs an invocation |

Blocked traffic never reaches a function, which is what keeps a scrape from becoming a bill. The
rules are reviewed after the first month of real traffic, and again if egress or invocation counts
move sharply.

## 9. Cost model

Costs scale with **edge requests, cache misses and edits** — not with visitors directly. The controls below keep that true.

| Driver | Uncontrolled behaviour | Control |
|---|---|---|
| Image optimizer | Every width × image × quality is a billed transformation (Hobby: 5,000/month) | Variants pre-generated with sharp; `images.unoptimized`; **0 transformations** |
| Cache keys | Per-request args ⇒ one cache entry per visitor | `PublicReadContext` singleton (ADR-013) |
| Nonce CSP | Forces dynamic rendering of every page | Nonce CSP on admin only; SRI hashes on public (ADR-014) |
| Viewport prefetch | A 24-card grid triggers ~24 prefetches per view | Hover prefetch on dense grids |
| OG images | Rendered per crawler/unfurl request | Pre-rendered into Blob at publish |
| Scrapers & abuse | Every request invokes a function | WAF at the edge blocks before compute |
| Rate-limit store | Redis command per keystroke | Upstash for login + prefill only |
| Junk URLs | Random facet slugs mint cache entries | 404 unless the facet value exists |
| Database | Always-on compute | Neon scale-to-zero kept on; caching keeps it idle |
| Storage | Orphaned uploads accumulate | Weekly media GC |
| CI minutes | Private repo on GitHub Free: 2,000 min/month, then blocked | Public repo: standard runners free (ADR-021) |

---

# 10. Architecture Decision Records

Each ADR is immutable once accepted. To change a decision, add a new ADR that supersedes or amends it and update only the older ADR's **Status** line. This is the mechanism for revising anything in PRD/SRS/this file.

---

### ADR-001 — Next.js monolith rather than a separate backend service
**Status:** Accepted · 2026-09-12 · *Related: ADR-014 (two origins, one deployment)*

**Context.** startupsHQ is read-heavy, relational and SEO-dependent. A separate API service was considered.
**Decision.** One Next.js App Router deployment containing UI, HTTP API and data layer.
**Consequences.** (+) One deploy, one type system, no network hop on the read path. (−) The DB credential lives in the same deployment as UI code, so the boundary is enforced by the compiler rather than the network (ADR-003).
**Revisit if:** a second consumer appears (mobile app, partner API), or the API must scale independently.

### ADR-002 — Server Components call services in-process; the browser goes through `/api/v1`
**Status:** Accepted · 2026-09-12 · *Refined by ADR-013*

**Context.** Having SSR fetch our own `/api/v1` over HTTP was considered on security grounds.
**Decision.** Server Components call services directly; every browser-originated request goes through `/api/v1`.
**Rationale.** A self-HTTP-call gives no isolation — the second invocation holds the identical `DATABASE_URL` in the same deployment — while adding a cold start per page, manual cookie forwarding and a self-reachability failure mode.
**Consequences.** Requires authorization in the data layer (ADR-003).
**Revisit if:** ADR-001 is reversed.

### ADR-003 — Authorization and visibility live in the data layer
**Status:** Accepted · 2026-09-12 · *Refined by ADR-013*

**Decision.** A context is the required first parameter of every service function. Reads derive visibility from `visibilityFilter(ctx)`; mutations open with `assertEditor(ctx)`. Constructors fail closed.
**Consequences.** (+) No entry path — handler, Server Component, script, test — reaches a write without an editor identity; a public ctx cannot return a draft. (−) Every signature carries a context parameter.
**Revisit if:** never, without a replacement offering equal or stronger guarantees.

### ADR-004 — Drizzle rather than Prisma
**Status:** Accepted · 2026-09-12

**Decision.** Drizzle ORM + drizzle-kit — it expresses `tsvector` generated columns, GIN/trigram indexes and `NULLS NOT DISTINCT` natively and keeps search and aggregate queries typed.
**Consequences.** (+) Typed FTS/stats. (−) More SQL knowledge required; thinner docs.
**Revisit if:** team DX outweighs typed raw-SQL access; cost confined to `src/server/services/*`.

### ADR-005 — One `investments` table with a nullable `round_id`
**Status:** Accepted · 2026-09-12 · *Amended by SRS v2: uniqueness is `NULLS NOT DISTINCT`*

**Decision.** `(startup_id, investor_id, round_id nullable, is_lead, amount_usd)`.
**Consequences.** (+) Single source of truth for "Backed by" and round participation. (−) `DISTINCT` on company-level reads. Postgres treats NULLs as distinct in unique constraints by default, which would allow duplicate `(s, i, NULL)` rows — hence `NULLS NOT DISTINCT`.

### ADR-006 — Typed facet storage with a separate copy layer
**Status:** Accepted · 2026-09-12

**Decision.** Facet values stay typed (enums, real tables); `taxonomy_pages` holds copy and SEO text. A facet value that doesn't exist is a 404, not a generated page.
**Consequences.** (+) DB refuses conflicting stages; one component serves five route shapes. (−) A new facet *kind* needs a migration.

### ADR-007 — Money as `bigint` whole USD
**Status:** Accepted · 2026-09-12 · *Amended by ADR-018*

**Decision.** Amounts are `bigint` whole USD; non-USD keeps `amount_original` + `currency`. No floats.

### ADR-008 — Keyset cursor pagination, never `OFFSET`
**Status:** Accepted · 2026-09-12 · *Amended by ADR-017: cursors are HMAC-signed and sort-aware*

**Decision.** Opaque keyset cursors.
**Consequences.** Stable under concurrent writes, constant cost at depth. The cursor must encode the active sort's key (`total_raised_usd`, `lower(name)`, `announced_on`), not always `created_at` — a mismatched keyset duplicates and skips rows.

### ADR-009 — Denormalized totals, owned by one writer
**Status:** Accepted · 2026-09-12 · *Amended by ADR-018 (definition of "raised")*

**Decision.** Derived totals on `startups`, recomputed in the transaction of any round write; only the rounds service writes them; a repair script exists.

### ADR-010 — Vercel + Neon + Vercel Blob
**Status:** Accepted · 2026-09-12 · *Amended by ADR-020 (plan tiers)*

**Decision.** Managed hosting; local dev on Docker Postgres.
**Consequences.** (+) No ops; per-PR database branches. (−) Vendor coupling; Cloudflare R2 is the documented exit for images.

### ADR-011 — Curated admin entry rather than crawling, for v1
**Status:** Accepted · 2026-09-12

**Decision.** Editors enter data via `/admin`, accelerated by prefill and CSV import. No crawlers. Prefill and import produce drafts.
**Revisit if:** published volume needs to exceed ~2,000 companies.

---

### ADR-012 — Store media; pre-generate variants; never hotlink or use the image optimizer
**Status:** Accepted · 2026-09-14

**Context.** Fetching logos and OG images live from startup websites was proposed, to avoid storage. Separately, Vercel's image optimizer bills per transformation (Hobby: 5,000/month).
**Decision.** Images are fetched once (upload or prefill), validated, re-encoded to WebP variants with sharp, and stored in Blob. Pages reference Blob URLs directly with `images.unoptimized`. Staged uploads are garbage-collected.
**Rejected — live fetching.** Page speed bound to the slowest startup site; outbound request volume at scale (≈ visitors × pages × cards) gets our IP blocked; expired startup domains can be bought and serve hostile images under our brand; an anonymous-visitor-triggered SSRF surface; visitor IPs leaked to hundreds of third parties (GDPR); OG banners are inconsistent in quality.
**Rejected — image optimizer.** Per-transformation billing grows with catalog × widths; pre-generation makes it zero.
**Consequences.** (+) Fast, stable, private, zero transformation cost; storage is tens of MB. (−) Images go stale when a startup rebrands — addressed post-v1 by a scheduled refresh-and-review job that flags changes for editor approval, never auto-replacing.
**Revisit if:** image storage or egress cost becomes material — move Blob to Cloudflare R2.

### ADR-013 — Next.js 16 Cache Components with a cache-safe `PublicReadContext`
**Status:** Accepted · 2026-09-14 · *Refines ADR-002 and ADR-003*

**Context.** Next.js 16 replaced `unstable_cache` with `'use cache'`, whose cache key is derived from arguments; deprecated single-argument `revalidateTag(tag)`; made `revalidateTag(tag, 'max')` stale-while-revalidate; and restricted `updateTag()` (read-your-writes) to Server Actions. Our per-request `ctx` carries `ip`, and an `authed` ctx can see drafts.
**Decision.** Public cached reads live in `src/server/cache/**` and accept only `PUBLIC_READ`, a frozen singleton carrying no identity. Public page routes read no cookies or headers. Writes (route handlers) call `revalidateTag(tag, { expire: 0 })`. Search is not cached per query.
**Rejected.** (a) Passing the request ctx into cached functions — per-visitor keys (zero hits) and draft leakage into the shared cache. (b) Moving all writes to Server Actions to use `updateTag` — would split the write surface between Actions and `/api/v1` for no gain, since `{ expire: 0 }` gives immediate expiry from route handlers.
**Consequences.** (+) Cache hits are shared by every visitor; drafts structurally cannot be cached publicly. (−) Editor previews need separate uncached reads.
**Revisit if:** Next.js changes `'use cache'` key derivation or invalidation semantics.

### ADR-014 — Separate admin origin; nonce CSP on admin, hash-based CSP on public
**Status:** Accepted · 2026-09-14 · *Amended by ADR-022: the public origin runs the fallback policy*

**Context.** A nonce-based CSP forces dynamic rendering of every page, disabling ISR and CDN caching and raising cost. But a weak public CSP matters if editor sessions are valid on the same origin as public pages.
**Decision.** Admin UI, auth and all writes live on `admin.startupshq.space` with a host-only session cookie. The admin origin uses a strict nonce CSP (it is dynamic anyway). The public origin uses hash-based CSP via Next.js `experimental.sri`; if unworkable, a CSP without script nonces that still enforces `object-src`, `base-uri`, `form-action`, `frame-ancestors` and image origins. CSRF is enforced by origin checks on every non-GET.
**Consequences.** (+) Public pages stay static and cheap; an XSS on the public origin finds no valid credential. (−) Two hostnames in DNS, local dev and tests; SRI is experimental.
**Revisit if:** Next.js ships stable hash-based CSP, or nonces stop forcing dynamic rendering.

### ADR-015 — Migrations run in GitHub Actions, not in the Vercel build
**Status:** Accepted · 2026-09-14 · *Supersedes the "migrations in the build step" line of SRS v1 §9* · *Depends on ADR-021*

**Context.** Running migrations in the build places a DDL-capable credential in every build environment, including PR builds and dependency install scripts, and lets a migration run before a deploy that then fails.
**Decision.** `migrate.yml` runs on merge to `main` in a protected GitHub environment with required approval, before the production deployment is promoted. Vercel never holds the migrator credential. Migrations are backward-compatible (expand → deploy → contract). Previews branch from a seed-data branch, never production.
**Consequences.** (+) A PR cannot alter production schema; no schema-ahead-of-code outages; preview URLs never expose production data. (−) One more workflow; migration discipline required.

### ADR-016 — Deletion is archiving; backups are independent of the database vendor
**Status:** Accepted · 2026-09-14

**Context.** Hard deletes plus Neon Free's 6-hour restore window mean an evening mistake — or a compromised editor — is unrecoverable by morning.
**Decision.** DELETE archives. Hard delete is admin-only and only for never-published records. Production uses Neon Launch (7-day restore). Nightly encrypted `pg_dump` to Cloudflare R2 (30 days), with a monthly automated restore test.
**Consequences.** (+) Mistakes are reversible; a second, off-vendor copy exists. (−) Archived rows remain in the DB (excluded from all public reads); privacy erasure is a separate, explicit path (ADR-019).

### ADR-017 — Edge rate limiting first; Redis only for low-volume sensitive limits
**Status:** Accepted · 2026-09-14 · *Amends ADR-008*

**Context.** Per-IP Upstash limits on every search keystroke cost a Redis command each, add latency and are bypassed by rotating-IP scrapers. The curated graph is the product's moat.
**Decision.** Vercel WAF rate rules (IP + JA4) and a bot challenge on `/api/v1/*` at the edge. Upstash only for login (per-IP hard limit, per-email progressive delay, no lockout) and prefill (per user), and as Better Auth's shared limiter storage. Cursors are HMAC-signed; anonymous pagination depth is capped; DTOs carry only UI fields; watermark phrasings detect copies.
**Rejected.** Account lockout per email — lets anyone lock out the admin indefinitely.
**Consequences.** (+) Abuse blocked before compute; Redis volume tiny. (−) Scraping is slowed and detectable, not prevented.

### ADR-018 — Server-side FX conversion and an explicit definition of "raised"
**Status:** Accepted · 2026-09-14 · *Amends ADR-007 and ADR-009*

**Context.** Global launch means many non-USD rounds; editor-entered conversions would be inconsistent. Summing debt, grants and secondary sales overstates what companies raised.
**Decision.** Editors enter currency + original amount; the server converts using ECB reference rates stored in `fx_rates` for the announcement date and records rate, date and source. `total_raised_usd` = equity + convertible rounds; debt is a separate total; grants and secondaries are excluded from totals.
**Consequences.** (+) Consistent, auditable totals. (−) A daily FX import job; rare currencies need an admin-entered rate.

### ADR-019 — Founder data is personal data
**Status:** Accepted · 2026-09-14

**Context.** Founder profiles of EU residents fall under GDPR. An append-only audit log retaining full diffs would keep erased personal data forever. Profile photos taken from social networks raise copyright and terms-of-service issues.
**Decision.** Audit diffs record personal fields by name only; audit IPs are nulled at 90 days and rows removed at 12 months by a separate retention role. An admin erasure path removes a founder, scrubs related audit rows and leaves only a hashed erasure record. Photos only when founder-supplied or licensed; initials otherwise. Attribution sources recorded. `/privacy` and a request process ship at launch, with legal review.
**Consequences.** (+) Erasure is actually possible; lower legal exposure. (−) Audit history cannot show old values of personal fields.

### ADR-020 — Free tiers for development; paid tiers for public launch
**Status:** Accepted · 2026-09-14 · *Amends ADR-010*

**Context.** Vercel Hobby is non-commercial only and caps image transformations and edge requests; Neon Free offers a 6-hour restore window and 0.5 GB; Upstash Free offers 500K commands/month.
**Decision.** Build on free tiers. Before public launch: Vercel Pro with spend management, Neon Launch, budget alerts at 50/80/100% on every paid service, monthly cost review.
**Consequences.** (+) Zero cost until launch; no surprise pauses after launch. (−) A fixed monthly base cost from launch day.

### ADR-021 — Public source repository
**Status:** Accepted · 2026-09-14 · *Enables ADR-015*

**Context.** On a private repository, GitHub Free/Pro/Team do not offer required reviewers, and environment secrets need a paid plan — so ADR-015's protected migration environment could not exist, and private-repo CI minutes are capped at 2,000/month. The owner made the repository public.
**Decision.** Source code and documentation are public. On public repositories GitHub Free provides environments with required reviewers, environment secrets, branch protection, secret scanning with push protection, and free standard-runner Actions minutes. The threat model assumes attackers can read the code, schema, endpoint list and these documents; **no security property may depend on their secrecy**. Repository hygiene per SEC-20.
**Consequences.** (+) ADR-015 works at no cost; free CI; free secret scanning. (−) The authorization model and schema are visible to attackers — acceptable because enforcement is structural (ADR-003, ADR-013, ADR-014), but it raises the stakes of SEC-20. Fork pull requests become an attack path into CI, hence SHA-pinned actions, read-only default permissions, approval for fork workflows and no `pull_request_target`. Competitors can read the product plan. Without a LICENSE the code is all-rights-reserved but still copyable in practice. The curated data — the actual moat — never lives in the repository, and neither does private operational material (watermark list, real `.env` values, backups, legal correspondence).
**Revisit if:** the repository must become private again — then required reviewers need GitHub Enterprise, or ADR-015 falls back to manually triggered migrations with repository secrets.

### ADR-022 — Inline scripts allowed on the public origin
**Status:** Accepted · 2026-09-16 · *Amends ADR-014*

**Context.** The Phase 12 spike judged `experimental.sri` sufficient from the build output: every emitted script file carried an `integrity` hash and pages still prerendered as static. It did not load a page in a browser. Phase 13 did, and found that Next.js also writes several **inline** scripts into every page (`self.__next_f.push(…)`, the React Server Components payload). `script-src 'self'` blocks them, React fails to hydrate (minified error #412), and no client component works — theme toggle, WebGL landing, load more, ⌘K search. SRI covers files only; the inline payload differs per page and changes on every revalidation, so no hash list in a header can name it, and a nonce needs per-request rendering.
**Decision.** Take the fallback ADR-014 recorded: the public origin sends `script-src 'self' 'unsafe-inline'`. Everything else stays: `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, `connect-src 'self'`, images only from ourselves and Blob, and SRI on script files. The admin origin keeps its nonce and `'strict-dynamic'`, under which `'unsafe-inline'` would be ignored anyway; it is not added there.
**Alternatives rejected.** *Nonces on the public origin* — every public page rendered per request: no static prerendering or CDN caching (ADR-013), higher cost, slower first byte. *No client JavaScript on the public origin* — drops the immersive landing, theming, search and paging the product needs.
**Consequences.** (+) Public pages stay static and cheap, and hydrate. The theme can be applied by a small inline script before paint, with no extra request. (−) An HTML-injection bug on the public origin could run script. The exposure is bounded by ADR-014's structure: no session, cookie or credential is valid on the public origin, writes are refused there, and there is nothing to exfiltrate that the public API does not already serve. React escapes all rendered text, and no public content is rendered as raw HTML; any future `dangerouslySetInnerHTML` on a public page needs a review against this ADR.
**Revisit if:** Next.js can externalise the RSC payload or hash it into a static policy, nonces stop forcing dynamic rendering, or anything credential-bearing ever has to be served on the public origin.

---

**See also:** [PRD.md](./PRD.md) · [SRS.md](./SRS.md) · [API.md](./API.md) · [TEST_PLAN.md](./TEST_PLAN.md) · [../TODO.md](../TODO.md)
