# startupsHQ — Build TODO

Execution sequence for [docs/PRD.md](./docs/PRD.md), [docs/SRS.md](./docs/SRS.md) and [docs/API.md](./docs/API.md).
Requirement IDs (`FR-*`, `SEC-*`, `NFR-*`, `DM-*`) refer to SRS.md — check the exact spec before building a task. Decisions and their rationale: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) §10.

**Order: the entire backend ships and is tested before any UI work begins.** The API is the contract; the frontend consumes a finished, verified one.

**Status:** Phase 9 complete — Phase 10 (paste-URL prefill) next · **Last updated:** 2026-09-16

---

## Legend

`[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked · `[?]` needs a spike / verification first
**EXIT:** the condition that must hold before moving on. Do not advance on a partially met exit condition.

## Milestone map

| # | Milestone | Phases | Proof it's done |
|---|---|---|---|
| M1 | Database live and seeded | 0–2 | `pnpm db:studio` shows the full fixture graph |
| M2 | Security primitives in place | 3 | Authz suite green on stubs; SSRF + cursor + IP unit tests green |
| M3 | Read backend complete | 4, 7 | Every public `GET /api/v1/*` correct via curl |
| M4 | Write backend complete | 5, 6, 8 | Full CRUD over curl on the admin origin with a 2FA session |
| M5 | **Backend complete** | 9–12 | All `SEC-01`…`SEC-18` verified at backend level; API frozen |
| M6 | Public site live | 13–17 | Graph traversal with no dead ends |
| M7 | Admin usable | 18 | A company added end to end in under 90 s |
| M8 | Launched | 19–24 | Production on paid tiers, backups restored, privacy live, 300 companies |

---

# PART A — BACKEND

## Phase 0 · Scaffold, tooling & supply chain

**Goal:** a wired repo that lints, typechecks, tests and refuses to build on a security regression.

- [x] `git init`, `.gitignore`, docs committed and pushed to the public repo `sanskarmishra479/StartupsHQ`
- [x] pnpm 12.4.1 installed via corepack
- [x] Docker Compose v2 installed (2.40.3)
- [x] `create-next-app` — **Next.js 16**, App Router, TypeScript, Tailwind v4, `src/`, Biome; `next` pinned to 16.3.4 (16.3.5 was under the release-age window with no security fixes)
- [x] `next.config.ts`: `cacheComponents: true`; `images.unoptimized: true` (ADR-012); `poweredByHeader: false`; baseline headers (nosniff, referrer policy, frame DENY, permissions policy)
- [x] `tsconfig.json`: ES2022, `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, alias `@/*`
- [x] `server-only` installed; Node tooling (drizzle-kit, later Vitest and scripts) runs with `--conditions=react-server` so the guard stays on every server file
- [x] **Supply chain (SEC-13):** `"packageManager": "pnpm@12.4.1"`; `pnpm-workspace.yaml` with `strictDepBuilds: true`, `dangerouslyAllowAllBuilds: false`, `minimumReleaseAge: 4320`, every dependency build script reviewed in `allowBuilds` (`esbuild`, `sharp`, `unrs-resolver` denied — prebuilt binaries); CI installs with `--frozen-lockfile`; audit gate is `pnpm audit --audit-level high`. No exceptions needed: the one known advisory is **moderate** (GHSA-67mh-4wv8-2f99, esbuild ≤ 0.24.2 via drizzle-kit — affects esbuild's dev server, which drizzle-kit never starts). High-severity exceptions, if ever needed, go in pnpm's audit config with an owner and expiry
- [x] `docker-compose.yml`: Postgres 17.11 pinned by digest, bound to 127.0.0.1 only, named volume, healthcheck, `startupshq_test` created on init
- [x] Local two-origin dev: `localhost` and `admin.localhost` both resolve (host routing itself is Phase 6)
- [x] `.env.example` with every variable from SRS §9 — no real values; copied to gitignored `.env.local` (mode 600)
- [x] `src/server/db/client.ts` — the **only** module reading `DATABASE_URL`; lazy pool, so builds never connect
- [x] `drizzle.config.ts` (migrations use `MIGRATION_DATABASE_URL`, local/CI only); generated `drizzle/` excluded from Biome
- [x] Vitest (`vitest.config.mts`, node env, `server-only` resolved to its empty module, `vitest.setup.ts` forces a `*_test` database) · Playwright config (Chromium, production build; specs in Phase 21). Per-suite truncate + reseed arrives with the schema in Phase 1–2
- [x] `scripts/check-bundle-leak.ts` — scans client chunks and prerendered HTML/RSC payloads for server secret **values** and `postgres(ql)?://` **(SEC-01)**; unit-tested, and verified to fail on a planted value in a real build
- [x] ~~Sentry SDK~~ **moved to Phase 20** — it does nothing before a DSN exists, and deferring it avoids reviewing `@sentry/cli`'s build script now
- [x] Directory skeleton per SRS §3.2
- [x] Scripts: `dev build start lint format typecheck test test:watch test:e2e check:leak db:up db:down db:generate db:migrate db:studio` — `test:cov` (Phase 4), `db:seed` (Phase 2), `seed:admin` (Phase 6), `recompute:derived` (Phase 5) are added with their files
- [x] `.github/workflows/ci.yml`: frozen install → lint → typecheck → tests (database started from `docker-compose.yml`, so CI and local share one Dependabot-maintained image) → build → `check:leak` → audit; read-only token, SHA-pinned GitHub-owned actions. First run green 2026-09-14
- [x] `.github/workflows/migrate.yml` skeleton (main only, `production` environment) **(ADR-015)** — inert until the `ENABLE_PRODUCTION_MIGRATIONS` repo variable is set in Phase 22
- [x] Dependabot config (`github-actions`, `docker-compose`; 3-day cooldown matching `minimumReleaseAge`; major PostgreSQL upgrades ignored). **`[?]` resolved — npm removed:** Dependabot found updates but failed to rewrite the pnpm 12 lockfile (`unknown_error` on all five), and the dependency graph lists only direct dependencies, so Dependabot alerts miss transitive packages. Covered instead by `.github/workflows/audit.yml` (weekly full-lockfile `pnpm audit`) plus the CI audit gate
- [x] **npm version updates — decided 2026-09-14: monthly manual review** (see *Recurring* below). No third-party app gets write access to the repository
- [ ] **Public repo hardening (SEC-20, ADR-021):**
  - [x] secret scanning + push protection enabled (2026-09-14)
  - [x] Dependabot alerts + security updates enabled (2026-09-14)
  - [x] branch protection on `main`: `verify` check required (bound to the GitHub Actions app), admin bypass for direct pushes, force pushes and deletion blocked (2026-09-14)
  - [x] Actions restricted to GitHub-owned actions only, with **SHA pinning required** by repo policy (2026-09-14)
  - [x] every workflow declares `permissions: contents: read`; repo default token is read-only and cannot approve PRs; no `pull_request_target`
  - [x] fork pull request workflows require approval for all external contributors
  - [x] `SECURITY.md` + GitHub private vulnerability reporting enabled
  - [ ] `production` environment with you as required reviewer — created in Phase 22 when secrets exist
- [x] **LICENSE — decided 2026-09-14: none (all rights reserved).** No LICENSE file is added; the root `README.md` created in Phase 0 states that all rights are reserved

**EXIT:** ✅ met 2026-09-14 — `docker compose up -d db` healthy · `pnpm typecheck && pnpm lint && pnpm build && pnpm check:leak` pass · CI green on first push · both local origins resolve.

---

## Phase 1 · Database schema  *(DM-01 … DM-13)*

**Goal:** the complete schema with every constraint, index and role from SRS §4.

- [x] Migration `0000_prologue`: `pg_trgm`, `unaccent`, the IMMUTABLE `immutable_unaccent(text)` wrapper **(DM-13)** (verified inside a generated column), NOLOGIN group roles and default privileges
- [x] `schema/enums.ts` — all 13 enums incl. `round_class`, `media_purpose`, `media_state`, `import_status` **(DM-01)**
- [x] `schema/locations.ts` (unique NULLS NOT DISTINCT), `schema/industries.ts` **(DM-07, DM-08)**
- [x] `schema/media.ts` — `media_assets` with staging/attached lifecycle **(DM-11)**
- [x] `schema/startups.ts` **(DM-02)** — shared lifecycle columns and checks; asset FKs; derived totals; `simple`-config generated `search_vector`; acquisition and founded_on checks; https-only URL checks; **no `now()`-based CHECK**
- [x] `schema/founders.ts` **(DM-03)** (plus `og_asset_id`) · `schema/investors.ts` **(DM-04)** · `schema/batches.ts` **(DM-05)**
- [x] `schema/rounds.ts` **(DM-06)** — generated `round_class` (verified for every round type); currency/fx columns; undisclosed and fx checks
- [x] `schema/fx.ts` — `fx_rates` **(DM-11)**
- [x] `schema/redirects.ts` — `slug_redirects` **(DM-11)**
- [x] `schema/taxonomy.ts` **(DM-09)**
- [x] `schema/joins.ts` **(DM-10)** — `startup_founders` stints (`id` PK, NULLS NOT DISTINCT stint key, `source_url`, `left_year ≥ joined_year`); `investments` unique **NULLS NOT DISTINCT**; `startup_batches`; `startup_industries` with partial unique primary
- [x] `schema/auth.ts` — generated with the Better Auth 1.7.4 CLI, then aligned (timestamptz, `user_role` enum, snake_case index names); tables `users`, `sessions`, `accounts`, `verifications`, `two_factors` **(DM-12)**
- [x] `schema/ops.ts` — `audit_log`, `import_jobs` (rows jsonb, sha256, expires_at), `erasure_log` **(DM-12)**; `0002_append_only_privileges` makes `audit_log`/`erasure_log` insert-only for the app and limits the retention role to `audit_log`
- [x] Indexes per **DM-13** — 36, incl. one keyset index per sort and trigram GIN on `immutable_unaccent(lower(name))`. Drizzle `relations` moved to Phase 4, next to the queries that exercise them
- [x] Roles **(SEC-10)**: migrations create NOLOGIN group roles `startupshq_app`, `startupshq_retention`, `startupshq_backup`; per-environment LOGIN users (and the migrator) are created outside git in Phase 22
- [x] `pnpm db:generate` → hand-review SQL → commit. Review found a **drizzle-kit bug: CHECK SQL is truncated at `;`** — fixed, and guarded by `schema.test.ts`. Vitest now migrates the test database before every run, so CI proves the migrations apply

**EXIT:** ✅ met 2026-09-14 — migrations run clean on an empty DB · Postgres itself rejects: undisclosed-with-amount, non-USD without fx fields, two primary industries, orphan round, duplicate `(startup, investor, NULL)` investment · `app_rw` cannot `CREATE TABLE` or `UPDATE audit_log` — all asserted in `constraints.test.ts`.

---

## Phase 2 · Seed data

**Goal:** fixtures exercising every edge case in TEST_PLAN §4. **Fictional only** (decided 2026-09-14): no real company or person enters this public repository; real content reaches production through the admin panel and CSV import.

- [x] `src/server/db/seed/` (fixtures + seed function) and `scripts/seed.ts` — idempotent, one transaction, `pnpm db:seed` / `pnpm db:seed:test`; refuses any non-local database unless `SEED_CONFIRM_DATABASE` names it
- [x] 19 startups, 16 founders, 13 investors, 5 batches, 29 rounds — all fictional (example.com links, RFC 5737 IPs)
- [x] **Global spread:** 12 countries on 6 continents; names with diacritics and a non-Latin script
- [x] `fx_rates` sample rows (illustrative) for the EUR round, with a weekend gap for date-fallback tests; NGN uses a manual rate
- [x] Every fixture in TEST_PLAN §4, each asserted in `seed.test.ts`, including: undisclosed; EUR with rate; unsupported currency; debt + grant + secondary on one startup; both acquisition shapes; two batches; founder with 3 startups and two stints at one; investor 5 rounds/2 led; NULL-round investment; empty founders/rounds; draft + archived per entity; previously-published archived; never-published draft; slug redirect; facets with 0 / 3 / ≥ 5 companies; stale staging media; old audit rows
- [x] **No founder photos** (SEC-18) — initials avatars
- [x] `taxonomy_pages` for top industries and stages; **none for work types**, so the generated-copy fallback is exercised
- [x] ~~`scripts/seed-admin.ts`~~ **moved to Phase 6** — it needs Better Auth configured to hash passwords and enforce 2FA
- [x] `src/server/db/derived.ts` — the one implementation of derived totals, counting **published** rounds only (an unpublished amount must never leak through a public total); used by the seed now and the rounds service in Phase 5
- [ ] Neon **seed-data branch** for previews (SEC-16) — created in Phase 22 with `SEED_CONFIRM_DATABASE=<branch db> pnpm db:seed`

**EXIT:** seeding twice yields identical state · every fixture queryable · totals match (published equity + convertible only).

---

## Phase 3 · Security primitives — **do not skip or reorder**

**Goal:** authorization, cache safety and outbound-request safety exist before the first service.

- [x] `auth/context.ts` — `Actor`, `RequestContext`, `PublicReadContext`, frozen `PUBLIC_READ`, `publicContext(ip)`, `authedContext(actor, ip)`; fail-closed, forged contexts rejected via a module-private brand **(SEC-03.4, SEC-03.6)**
- [x] `auth/guards.ts` — `assertEditor`, `assertAdmin` (type-narrowing, throw `ForbiddenError`) **(SEC-03.3)**
- [x] `auth/visibility.ts` — `visibilityFilter(ctx)`; public and public-read ⟹ published only **(SEC-03.2)**
- [x] `lib/errors.ts` — typed errors with safe client messages **(SEC-12)**
- [x] `lib/cache-tags.ts` — the only tag builder **(NFR-02)**
- [x] `src/lib/slug.ts` **(FR-403)** · `src/lib/money.ts` **(NFR-08)** — client-safe, so they live outside `src/server` · `lib/fx.ts` (latest rate ≤ 7 days before, exact half-up rounding) **(FR-406)**
- [x] `lib/cursor.ts` — HMAC-signed, sort-aware keyset cursor + depth counter **(SEC-15)**
- [x] `lib/ip.ts` — trusted client IP (`x-real-ip` only on Vercel, which overwrites it), local fallback **(SEC-14)**
- [x] `lib/origin.ts` — admin-origin / `Sec-Fetch-Site` check **(SEC-04)**
- [x] `lib/safe-fetch.ts` — undici agent with connect-time IP validation, manual re-validated redirects ≤ 3, 5 s, 5 MB **(SEC-05)**
- [x] **Authz conformance harness** (TEST_PLAN §7) incl. cached-read table and registry completeness; green on stubs — `src/server/testing/authz.ts`, suite at `src/server/services/authz.test.ts`, proven against a deliberately broken fixture service
- [x] Type test: a `src/server/cache/**` function rejects `RequestContext` at compile time
- [x] Unit tests for every helper above, incl. the full SEC-05 IP-form list and a DNS-rebinding mock

**EXIT:** ✅ authz suite green · every SEC-05 unit case rejected with no private socket opened · spoofed `X-Forwarded-For` ignored · tampered and sort-mismatched cursors rejected.

---

## Phase 4 · Service layer — reads

- [x] `services/startups.ts` — `getBySlug` (incl. redirect lookup), `list(ctx, filters, sort, cursor)`, `listSimilar` · shared card query in `db/queries/startup-cards.ts` applies visibility at every join
- [x] `services/founders.ts`, `services/investors.ts` (`getPortfolio`, `getRoundsLed`; the breakdown is computed inside `getBySlug`, so no separate `getBreakdown`), `services/batches.ts` (`getStats`), `services/rounds.ts` (`listRecent`, `listForStartup`) · shared `db/queries/{rounds,slugs,sql}.ts` and `lib/keyset.ts`
- [x] `services/taxonomy.ts` — `getPage` returns NotFound for nonexistent values; `isGenerated`; `isIndexable` (< 5 ⇒ false) **(FR-108)** · `listCategories` for the `/categories` directory **(FR-107)**; counts include acquired companies; a country page needs a country-level `locations` row
- [x] `services/search.ts` — ranked FTS (`simple` + unaccent), trigram fallback, `suggest` ≤ 8; **not cached** · trigram uses word similarity (`%>`, threshold 0.6); suggest ranks name prefix > word prefix > fuzzy in one round-trip
- [x] `services/stats.ts` — `getCounts`: visible counts per entity (public totals; admin dashboard FR-202) · enum labels and enum ⟷ slug mapping in client-safe `src/lib/labels.ts`
- [x] `src/server/dto/*` — minimal public DTOs; `Image` with variants **(SEC-15)**
- [x] **`src/server/cache/*`** — `'use cache'` + `cacheTag` wrappers accepting only `PUBLIC_READ`, with runtime guard **(SEC-03.6, NFR-02)** · exported guard + private cached scope keyed by public arguments only; absence returned as `{ kind: "not-found" }` because thrown errors become digests across the cache boundary; malformed input never reaches the cache; explicit `cacheLife` everywhere
- [x] Keyset pagination per sort using DM-13 indexes — `recent` / `raised` / `name`, stable under mid-pagination inserts
- [x] ~~`src/server/db/relations.ts`~~ — **not used (decided 2026-09-14):** Drizzle's relational queries cannot apply a status predicate on one-to-one hops (acquirer, a round's investor), so a draft could leak through them. Reads use explicit joins, each passing through `visibilityFilter` / `visibleSql` (SEC-03.2)
- [x] Integration tests per TEST_PLAN §6 (reads), incl. pagination stability for each sort · "two visitors share one cache entry" is covered structurally here (frozen identity-free `PUBLIC_READ`; static scan: no cached scope takes a context or reads request data); the real one-query-for-two-visitors check needs a production build and moves to Phase 22
- [x] Assert ≤ 3 round-trips for the company page on a miss **(NFR-01)** — also founder pages

**EXIT:** ✅ every read tested · no draft/archived leak via services or cache · coverage ≥ 80% — `pnpm test:coverage` (`@vitest/coverage-v8`, decided 2026-09-14): services 100% lines, `src/server` 89% lines / 86% branches; the 80% services threshold is enforced in `vitest.config.mts`.

---

## Phase 5 · Service layer — writes

- [x] `src/server/validation/*` — Zod per entity (`z.strictObject`); `founded_year` range; rounds reject client-supplied `amountUsd`/fx **(SEC-02)** — `shared.ts`, one module per entity plus `relations.ts`; services parse their own input
- [x] Create / update / publish (sets `first_published_at`, triggers OG render hook) / unpublish for all five entities — `services/{startup,founder,investor,batch,round}-writes.ts` + `services/lifecycle.ts`; the OG render hook lands with OG rendering (FR-111)
- [x] **Lifecycle:** DELETE ⇒ archive; restore; hard delete admin-only and only when never published **(FR-407)** — invalid transitions 422; round status changes recompute totals in-transaction
- [x] **Slug change** admin-only with flattened `slug_redirects` **(FR-409)** — `services/slug-writes.ts`; redirects point at the entity id, so chains are flat by construction; moving back to an own old slug removes that redirect; founder slug changes audited by name only · category copy upsert (FR-205, API §8.4) in `services/category-writes.ts`, 404 for facet values that do not exist
- [x] Relationship writes incl. founder stints and `source_url` — `services/relation-writes.ts`; nested `POST /startups` creates links and rounds in one transaction via `db/writes/{relations,rounds}.ts`
- [x] Inline draft creation from pickers **(FR-204)** — every `create` makes a draft
- [x] **FX conversion** on round write; admin manual-rate path **(FR-406)** — client amounts/rates rejected as unknown fields; manual rate refused when an ECB rate exists for the date
- [x] Derived totals (`total_raised_usd` equity+convertible, `total_debt_usd`, `latest_round_id`) in-transaction **(FR-404)** — on round update and on every round status change
- [x] `services/audit.ts` — in-transaction, personal fields by name only **(FR-405, SEC-11)** — lives in `db/audit.ts` (`writeAudit`, `auditDiff`) because it runs inside other services' transactions; an admin audit read belongs to the dashboard phase
- [x] `services/privacy.ts` — request records; `eraseFounder` with audit scrub + `erasure_log` **(FR-410)**. The app role cannot UPDATE `audit_log`, so the scrub goes through a narrow `SECURITY DEFINER` function that can only redact one entity's audit rows — migrations `0003_privacy_requests` (table) and `0004_founder_erasure_scrub` (`scrub_founder_audit(uuid)`: pinned `search_path`, refuses while the founder exists, EXECUTE revoked from PUBLIC and granted to the app role only). Erased photos return to staging past the 24 h window, so the media GC deletes the files
- [x] `revalidateTag(tag, { expire: 0 })` for every affected tag, incl. neighbours **(NFR-02)** — `db/mutation.ts` expires only after commit; `db/writes/tags.ts` collects neighbours per entity (old slugs, acquired companies, founders, investors, batches)
- [x] `scripts/recompute-derived.ts` — `pnpm recompute:derived [--test]`, via `repairStartupDerived` (one transaction, reports how many startups were wrong); cannot expire caches from outside Next.js, so it says to redeploy after a repair
- [x] Tests per TEST_PLAN §6 (writes, lifecycle, privacy, caching freshness) — `src/server/cache/freshness.test.ts` reads ~30 cached pages, performs each of 15 writes, and fails on any page that changed without its tags expiring; a control write that bypasses the services proves it detects staleness. It caught a gap: an acquired company's card names its acquirer, so `startupTags` now also expires the acquired companies' neighbours
- [x] Authz suite covers **100%** of mutations incl. admin-only table — registry completeness fails on any unregistered export

**EXIT:** ✅ authz suite complete · publish makes a record public and archive hides it (`lifecycle.test.ts`) · totals and FX correct on fixtures (`round-writes.test.ts`, `relation-writes.test.ts`) · erasure leaves no personal data in audit rows (`privacy.test.ts`) · 711 tests; services 98% lines.

---

## Phase 6 · Authentication  *(SEC-04, SEC-08, FR-201, FR-208)*

- [x] `auth/better-auth.ts` — Drizzle adapter, email + password (scrypt default), **two-factor (TOTP) plugin, mandatory**, 10 recovery codes. Better Auth's 2FA is opt-in, so enforcement is ours: `requireEditor()` refuses users without `two_factor_enabled`, and first login forces enrollment — sign-up closed; plugin account lockout disabled (SEC-08)
- [x] **Spike: cookie prefix.** Verify whether Better Auth can emit a `__Host-` cookie on the admin origin. If yes, use it; if not, `__Secure-` with **no `Domain` attribute** (host-only). Record the outcome in SRS SEC-04. — **`__Host-` works** (2026-09-15): Better Auth's own prefix disabled, cookie named `__Host-startupshq.*` with Secure, Path=/, no Domain; verified in `auth-flow.test.ts`
- [ ] Sessions: httpOnly, Secure, SameSite=Lax, rotation on privilege change, server-side revocation — all done and tested except **rotation on privilege change**, which lands with role changes in the users service (FR-208)
- [x] Better Auth rate limiter → Upstash secondary storage (in-memory does not work on serverless) — as `rateLimit.customStorage`, not `secondaryStorage`: the latter would move **sessions** into Redis, so an outage would sign everyone out
- [x] Login limits: 20 / 15 min per IP; progressive delay per email after 5 failures; **no lockout**; fail closed if Upstash unavailable — `auth/login-limits.ts`; local and CI store is Redis + serverless-redis-http in `docker-compose.yml` (decided 2026-09-15)
- [ ] Transactional email provider: invites, password reset, 2FA reset notices **(FR-201, FR-208)** — **Resend** (decided 2026-09-15), `lib/email.ts`; password reset wired; invites and 2FA-reset notices land with the users service
- [x] `getSessionContext()` → `RequestContext`; unverifiable or 2FA-incomplete ⇒ `publicContext()` — `auth/session.ts` (`getSessionStatus` also reports `enrollment-required`)
- [x] `requireEditor()` / `requireAdmin()` handler helpers (layer 2)
- [x] **`src/proxy.ts`** (not `middleware.ts`) — host routing: `/admin/*`, `/api/auth/*`, non-GET `/api/v1/*` only on the admin host; session gate for `/admin/*` (layer 1) — rules in pure `src/lib/host-routing.ts`: any host other than the admin host is public (fails closed, incl. preview hosts and missing config); paths decoded and lowercased before matching; the admin host serves only `/admin`, `/api/auth`, `/api/v1` and `/_next` (`/` → `/admin`, else 404) with `X-Robots-Tag: noindex`
- [x] `/api/auth/[...all]` on the admin origin — the auth instance is created on first request, so builds need no auth secrets
- [x] `scripts/seed-admin.ts` — first admin from CLI args, password hashed by Better Auth, 2FA enrollment forced on first login (moved from Phase 2) — `pnpm seed:admin --email … --name …`; the password comes only from `SEED_ADMIN_PASSWORD`, never an argument
- [x] Tests: enrollment forced; recovery code single-use; login without 2FA cannot write; revoked session rejected; no lockout from another IP; editor refused admin-only action; admin paths 404 on public host — `auth-flow.test.ts`, `login-limits.test.ts`, `src/proxy.test.ts`

**EXIT:** ✅ three independent layers verified **(SEC-03.5)** — layer 1 `src/proxy.test.ts`, layer 2 `auth-flow.test.ts` (`requireEditor`/`requireAdmin`), layer 3 the authz suite · `seed-admin.ts` → working login with 2FA (smoke-run against the test database; the same `createCredentialUser` drives the 2FA sign-in tests) · cookie-prefix spike recorded (SRS SEC-04). Deferred to the users service (FR-208): session rotation on role change; invite and 2FA-reset emails.

---

## Phase 7 · API — read endpoints  *(API.md §6)*

- [x] Shared handler wrapper: trusted IP → Zod → ctx → service → DTO → JSON, uniform error mapping **(SEC-12)** — `src/server/http/handler.ts` (`publicRead`); query schemas in `src/server/validation/queries.ts`. Reads never look at cookies, so they are anonymous on both origins; admin reads that include drafts come with Phase 8
- [x] All read endpoints in API.md §6 on the public origin — `src/app/api/v1/**/route.ts`. Slug detail pages, similar, categories and unfiltered first pages go through `src/server/cache`; filtered, later and search pages call services with `publicContext(ip)`
- [x] 301 for old slugs; 404 for unknown/draft/archived/nonexistent facet values
- [x] Signed cursors, sort match, anonymous depth ≤ 20, `limit` ≤ 48 **(SEC-15)**
- [x] `robots.txt` disallows `/api/` — `src/app/robots.ts`
- [x] Contract tests per TEST_PLAN §9 (reads) — `src/app/api/v1/read-endpoints.test.ts` against strict DTO schemas in `src/server/testing/contract.ts`; wrapper unit tests in `src/server/http/handler.test.ts`

**EXIT:** ✅ every read endpoint matches API.md · no draft reachable · pagination guarantees hold for each sort (full walks match single pages; a company published mid-walk causes no gap or repeat).

---

## Phase 8 · API — write & admin endpoints  *(API.md §8)*

- [x] Wrapper extension for non-GET: **origin check (403)** and **JSON content-type (415)** before anything else **(SEC-04)** — `src/server/http/authed.ts` (`authedRoute`): origin → content type → session (401) → role (403) → JSON body capped at 256 KB (413); responses `Cache-Control: private, no-store`
- [x] Entity lifecycle endpoints incl. publish/unpublish/archive/restore/hard delete — create, update, publish, unpublish, archive, restore and hard delete for all five entities (`src/server/http/entity-routes.ts`); admin list and admin read by id in `src/server/services/admin-reads.ts`, served on the admin origin at the same paths as the public reads (`byOrigin`)
- [x] `POST /{entity}/{id}/slug` (admin)
- [x] Relationship sub-resources; taxonomy upsert for existing values only
- [x] Users (invite, role, reset-2fa, deactivate) · privacy requests + founder erasure — `src/server/services/users.ts` (+ reactivate): invites reuse the password-reset link worded as an invite; `users.deactivated_at` (migration 0005) switches an account off, refused at sign-in like a wrong password; role change, 2FA reset and deactivation each revoke sessions, closing **rotation on privilege change** (SEC-04) and the invite/2FA-reset emails deferred from Phase 6
- [x] Status codes per API.md §4 — for every endpoint built so far
- [x] Contract tests: anonymous → 401; no 2FA → 401; editor → 2xx; editor on admin-only → 403; cross-origin → 403; wrong content-type → 415; write on public origin → 404 — `src/app/api/v1/write-endpoints.test.ts`, with real sessions that completed TOTP

**EXIT:** ✅ full CRUD over HTTP on the admin origin with a real 2FA session (`write-endpoints.test.ts`, `admin-endpoints.test.ts`) · **API contract frozen 2026-09-16** (API.md §9: additive changes stay in v1; anything else needs `/api/v2`). Also added, beyond the original list: a per-account write budget of 120/min that fails open (SEC-08), and `POST /users/{id}/reactivate`, so deactivation is not a one-way door.

---

## Phase 9 · Media pipeline  *(SEC-06, FR-408, FR-111)*

- [x] `services/media.ts` — magic-byte sniff, allowlist (jpg/png/webp; **SVG refused**, tightening SEC-06), 5 MB cap
- [x] sharp: `limitInputPixels: 24_000_000`, `failOn: 'error'`, output dimension caps. SVG density and external refs are moot now that SVG is refused. Dimensions are read from the header with the limit off, so a bomb answers `422 IMAGE_TOO_LARGE` rather than "unreadable"
- [x] WebP variants per purpose (logo 64/128/256 · cover 640/1280/1920 · photo 128/256/512) + blur placeholder
- [x] Blob upload under random prefixes; `media_assets` in `staging`; attach on entity save — `lib/blob.ts` keeps blobs in memory without a token, so development and tests never reach the network
- [x] **OG image rendering** at publish/update via `next/og` → `og` asset **(FR-111)** — `media.refreshOgImage`, called by the publish and update routes; a failure is logged and never undoes the write
- [x] `POST /api/v1/media`
- [x] `maintenance.yml` → media GC job (staging > 24 h, unreferenced > 7 days) — `pnpm media:gc`, inert until `ENABLE_MAINTENANCE=true` in Phase 22
- [x] Tests per SEC-06 matrix, incl. the 50,000 × 50,000 px bomb completing without memory blow-up

**EXIT:** ✅ upload → variants → Blob → attach works · every SEC-06 test green · GC test green · share cards render through `next/og` in the test suite.

---

## Phase 10 · Paste-URL prefill  *(FR-401, SEC-05)*

- [ ] `services/prefill.ts` — `safeFetch` for the page
- [ ] Parse OG → JSON-LD → title/meta → icons
- [ ] **Every image/icon URL through `safeFetch` again**, then through the media pipeline as staging assets
- [ ] Firecrawl fallback; **URLs it returns go through `safeFetch`**; absent key degrades gracefully
- [ ] Location guess → existing `locations` row or flagged
- [ ] Always a partial draft; never persisted as an entity
- [ ] `POST /api/v1/prefill` — editor, 20/hour, fail closed
- [ ] Tests: full SEC-05 matrix at the endpoint, incl. rebinding, hostile `og:image`, hostile Firecrawl URL

**EXIT:** a real URL yields a usable draft · no private-address socket ever opened in tests.

---

## Phase 11 · CSV bulk import  *(FR-402, SEC-07)*

- [ ] `services/import.ts` — papaparse, 1,000-row cap, per-row Zod collecting all errors
- [ ] Duplicate detection: slug, then batched trigram query (> 0.85)
- [ ] Dry-run stores normalized rows + SHA-256; `expires_at` = +24 h
- [ ] Commit uses stored rows, re-validates inside the transaction → `IMPORT_STALE` on conflicts; single transaction; drafts; `import_jobs` updated
- [ ] Raw value storage; **formula neutralization only in `export.csv`**
- [ ] Endpoints: dry-run, commit, export
- [ ] Tests per SEC-07 matrix; fixture CSV in `scripts/fixtures/`

**EXIT:** reviewed import commits cleanly · a conflicting edit between dry-run and commit aborts with zero rows written.

---

## Phase 12 · Backend hardening & verification

- [ ] **CSP split (SEC-09):** admin nonce CSP via `proxy.ts`; `[?]` spike `experimental.sri` hash CSP on public pages and confirm pages remain statically cached — if not workable, implement the documented fallback and record it
- [ ] Other headers on both origins; **HSTS without `preload`** **(SEC-19)**
- [ ] WAF rule definitions written down (thresholds, keys, bot challenge) for Phase 22 **(SEC-08)**
- [ ] Upstash fail-closed behaviour verified for login and prefill
- [ ] `maintenance.yml` → **audit retention** job under `retention` role **(SEC-11)**
- [ ] `maintenance.yml` → **FX import** job (ECB) **(FR-406)**
- [ ] Role tests **(SEC-10)** · error-shape audit **(SEC-12)** · supply-chain checks **(SEC-13)**
- [ ] `pnpm build && pnpm check:leak` — zero hits **(SEC-01)**
- [ ] Coverage report: services ≥ 80%; 100% mutations + cached reads in authz suite **(NFR-10)**
- [ ] Run `/security-review` on the full backend and resolve findings
- [ ] **Verify `docs/API.md` against the implemented handlers**; fix whichever side is wrong; mark v1 frozen

## ✅ MILESTONE M5 — BACKEND COMPLETE

**Nothing below starts until every box above is checked.**

---

# PART B — FRONTEND

## Phase 13 · Design system  *(NFR-04, NFR-05, NFR-06)*

- [ ] Tokens as CSS custom properties (color, spacing, radii, shadows, type scale); dark mode via `prefers-color-scheme` + `[data-theme]`
- [ ] Typography: display + text face, tuned scale
- [ ] shadcn/ui restyled to tokens
- [ ] Primitives: `EntityCard`, `ResponsiveImage` (srcset from `variants`, blur placeholder), `InitialsAvatar`, `MetaRow`, `StatTile`, `Money` (USD + original currency), `SectionHeading`, `EmptyState`, `LoadMore`
- [ ] Focus rings, ≥ 4.5:1 contrast both themes, reduced motion
- [ ] Responsive at 360 / 768 / 1280 / 2560

**EXIT:** components gallery in both themes · axe clean.

## Phase 14 · App shell & explore grid  *(FR-101)*

- [ ] Public layout: header, footer, skip link, theme toggle — **no cookie or header reads**
- [ ] `/` via `src/server/cache` reads
- [ ] Facets and sort as URL params; mobile filter sheet
- [ ] Load more via `GET /api/v1/startups` with signed cursor; depth-limit message
- [ ] **Card links: hover prefetch, not viewport prefetch** **(NFR-11)**
- [ ] Skeletons, empty state, error boundary

**EXIT:** filtered/sorted URLs restore exactly on reload · no duplicate cards across pages.

## Phase 15 · Entity pages  *(FR-102 … FR-106)*

- [ ] `/companies/[slug]`, `/founders/[slug]`, `/investors/[slug]`, `/batches/[slug]`, `/news`
- [ ] 404 for unknown/draft/archived; **301 for old slugs**
- [ ] Totals: raised, and debt separately when present; non-USD rounds show original currency
- [ ] Founder pages render multiple stints; initials when no photo
- [ ] **Every entity mention is a link** — explicit audit

**EXIT:** PRD §8 traversal completes with zero dead ends, by hand and by Playwright.

## Phase 16 · Category pages  *(FR-107, FR-108)*

- [ ] `/categories` (facets with ≥ 1 company) and five route shapes via one component
- [ ] 404 for nonexistent values; `noindex` when `isIndexable` is false
- [ ] Generated fallback copy for real values without a taxonomy row

**EXIT:** real, thin and random-slug cases behave per `categories.spec.ts`.

## Phase 17 · Search UI  *(FR-109)*

- [ ] ⌘K palette on `/api/v1/suggest`, debounced 150 ms
- [ ] `/search` grouped with type tabs; "showing results for" on trigram matches
- [ ] Keyboard navigation, ARIA combobox, announced counts
- [ ] Recent searches in `localStorage` (try/catch)

**EXIT:** misspellings and diacritic-free queries find results · keyboard-only operable · suggest p95 ≤ 150 ms.

## Phase 18 · Admin UI  *(FR-201 … FR-210)* — admin origin only

- [ ] Login → **2FA enrollment / challenge**; recovery codes UI; password reset
- [ ] Dashboard: counts, drafts, recent audit, pending imports
- [ ] Lists with status filter (draft/published/archived), bulk publish, **archive / restore**
- [ ] Startup form: sections, shared Zod schemas, dirty-state guard, Save-draft vs Publish
- [ ] Comboboxes with inline draft creation; founder stints with `sourceUrl`
- [ ] Round rows: currency selector + original amount; server-computed USD shown after save; undisclosed hides amounts; admin manual-FX dialog
- [ ] Image upload (drag-drop, preview, progress) → staging assets
- [ ] Prefill: paste URL → per-field accept; warnings for rejected images
- [ ] Import: upload → dry-run table → commit within 24 h → stale/expired handling → export report
- [ ] **Admin-only:** slug change dialog, hard delete (never-published only), users (invite, role, reset 2FA, deactivate), **privacy** (requests, founder erasure with typed confirmation)
- [ ] `/admin/categories`, `/admin/media`

**EXIT (M7):** company with 2 founders, 3 investors, a batch and a EUR round added end to end in **under 90 seconds**, timed.

---

# PART C — LAUNCH

## Phase 19 · SEO & metadata  *(NFR-03, FR-110, FR-111)*

- [ ] `generateMetadata` everywhere: unique title, description, canonical (current slug)
- [ ] OG/Twitter tags pointing at pre-rendered Blob OG images
- [ ] JSON-LD `Organization`, `Person`, `BreadcrumbList`
- [ ] `sitemap.ts` — published entities + indexable facets only; `robots.ts`
- [ ] Verify `noindex` only on thin facets and non-content routes

**EXIT:** rich-results test passes on a company and founder page · thin facets absent from sitemap.

## Phase 20 · Polish & accessibility

- [ ] Keyboard pass; axe clean on `/`, company, founder, `/search`, `/admin`
- [ ] Skeletons, error boundaries, CLS ≈ 0; dark mode audit; 404/500 pages
- [ ] Lighthouse ≥ 95 / 100 on a company page
- [ ] Sentry SDK installed (moved here from Phase 0) and receiving events from preview with PII scrubbed **(NFR-07)**

## Phase 21 · End-to-end suite

- [ ] All specs in TEST_PLAN §10 on both origins, in CI on every PR

## Phase 22 · Production operations & deploy  *(NFR-11, NFR-12, SEC-08, SEC-16, SEC-17)*

- [ ] **Accounts & plans (you):** Vercel **Pro** with spend management; Neon **Launch**; Upstash; Cloudflare R2 bucket with 30-day lifecycle; email provider; Sentry
- [ ] Call `attachDatabasePool(pool)` from `@vercel/functions` in `db/client.ts` so Fluid compute drains idle Neon connections before a function suspends
- [ ] **Verify cache persistence on Vercel (NFR-02, ADR-013):** Next.js documents that the default in-memory `'use cache'` store usually does not persist across serverless instances. Against a preview deploy, request one company page from two clients and count DB queries. If entries are not shared, decide between relying on prerendered/ISR page output and `'use cache: remote'` (platform cache, extra cost) — a decision for the owner, with numbers
- [ ] **Budget alerts** at 50 / 80 / 100% on Vercel, Neon, Upstash
- [ ] DNS: `startupshq.space` (bought 2026-09-16) + `admin.startupshq.space`; TLS on both
- [ ] Vercel env vars per SRS §9, **production secrets scoped to Production only**; migrator credential **not** in Vercel
- [ ] Neon: per-environment LOGIN users granted the migration-created group roles (`startupshq_app`, `startupshq_retention`, `startupshq_backup`), plus the migrator; pooler; scale-to-zero kept on
- [ ] Previews: Neon branch from the seed-data branch; **Vercel Authentication** on
- [ ] `migrate.yml` live in the protected `production` environment; expand/contract rule documented in `docs/DEPLOY.md`
- [ ] **Vercel WAF** rules from Phase 12 applied to `/api/v1/*`; bot challenge on list endpoints
- [ ] `backup.yml` nightly → R2 (age-encrypted; private key stored offline by you)
- [ ] `restore-test.yml` run once manually and passing
- [ ] `maintenance.yml` scheduled (retention, media GC, FX)
- [ ] `docs/DEPLOY.md`: deploy, rollback, restore-from-R2 runbook
- [ ] **HSTS without preload**

**EXIT:** a restore from R2 has succeeded · alerts fire on a test threshold · previews contain no production data.

## Phase 23 · Privacy & legal  *(SEC-18, FR-112)*

- [ ] `/privacy`: data held, lawful basis, rights, contact address, 30-day response
- [ ] `/about`: sourcing, corrections, takedown
- [ ] Privacy request procedure in `docs/DEPLOY.md` (or a dedicated runbook)
- [ ] Founder photo policy applied to all content (licensed/supplied only)
- [ ] **Legal review of `/privacy`, `/about`, founder data handling and logo use (you, with counsel)**

## Phase 24 · Content load

- [ ] 300 companies published, ≥ 1.5 founders each, ≥ 80% with a cited round, ≥ 12 countries **(PRD §10)**
- [ ] Taxonomy copy for every indexable facet
- [ ] Watermark phrasings recorded in a private list **(SEC-15)**
- [ ] Post-launch: pages-per-session ≥ 3.5; monthly cost review

---

## Recurring (from Phase 0 onward)

- [ ] **Monthly — npm dependency review** (first due 2026-10-14): `pnpm outdated`; update in small commits that respect the 3-day release age; CI green after each; major versions one at a time with changelog review
- [ ] **Weekly, automated — `audit.yml`**: full-lockfile `pnpm audit`; investigate any failure the same day

## Post-launch

- [ ] **HSTS preload** after ≥ 3 months stable HTTPS on all subdomains **(SEC-19)**
- [ ] Scheduled logo/OG **refresh-and-review** job — flags changes for editor approval, never auto-replaces (ADR-012)
- [ ] Tune WAF thresholds from real traffic
- [ ] Re-evaluate Next.js `experimental.sri` status

## Deferred beyond v1

Jobs board · public accounts, follows, watchlists · automated crawlers · paid data providers · newsletter · public third-party API · founder alumni networks · funding trend charts. None are blocked by the schema.
