# startupsHQ — Test Plan

**Status:** Draft v2 · **Last updated:** 2026-09-16 · Companion to [SRS.md](./SRS.md)

Every `SEC-*`, `FR-*` and `NFR-*` requirement in SRS.md must have a named verification here. A requirement with no test is not implemented — only intended.

---

## 1. Quality gates

Every push to `main` runs these gates. Commits go directly to `main` (admin bypass while solo, decided 2026-09-14), so **a failing gate is fixed before any other work continues**:

| Gate | Threshold | Enforced by |
|---|---|---|
| Typecheck | zero errors, `strict` | CI |
| Lint / format | zero Biome errors | CI |
| Unit + integration | all green | CI |
| **Authz conformance suite** | green; 100% of mutations and 100% of `src/server/cache/**` registered | CI |
| Service-layer coverage | ≥ 80% lines (NFR-10) | CI |
| Client bundle secret scan | zero hits | `check-bundle-leak.ts` |
| Dependency audit | no unlisted high-severity advisory; listed exceptions unexpired | `pnpm audit` + exceptions file |
| Frozen lockfile | install succeeds with `--frozen-lockfile` | CI |
| E2E | all green | CI, from Phase 18 (Admin UI) |
| axe | zero violations on the 5 key pages | CI, from Phase 20 (Polish) |
| Lighthouse (company page) | ≥ 95 perf / 100 SEO | pre-release, manual |

## 2. Levels

| Level | Tool | Scope | Runs against |
|---|---|---|---|
| **Unit** | Vitest | Pure helpers: slug, money, fx, cursor, ip, origin check, safe-fetch IP classifier, DTO mappers, CSV parsing/export | no DB |
| **Integration** | Vitest + Docker Postgres | Services with real SQL and constraints | test DB |
| **Authz conformance** | Vitest | Context behaviour of every service and cached read | test DB |
| **Contract** | Vitest + route handlers | `/api/v1` request → response, codes, envelopes, origins | test DB |
| **E2E** | Playwright | Real browser on both origins (`localhost`, `admin.localhost`) | built app + test DB |
| **Ops** | GitHub Actions | Migration, backup, restore, retention, GC jobs | scratch Neon branch |
| **Non-functional** | Lighthouse, axe, manual | Perf, a11y, responsive, SEO, cost | preview |

**Deliberately not mocked:** the database — its constraints are behaviour under test. Mocked: external HTTP only (target sites, Firecrawl, email provider, ECB feed), and DNS where testing rebinding.

## 3. Test database lifecycle

- `startupshq_test` in the local Docker Postgres; CI uses a Postgres 17 service container.
- Migrations once per run via Vitest global setup (including `immutable_unaccent` and extensions), so every run proves the committed migrations apply; **truncate + reseed before each suite file**. Constraint and privilege tests run inside rolled-back transactions instead (`constraints.test.ts`).
- `scripts/seed.ts --test` so fixtures equal development data.
- DB-role tests connect as `app_rw`, `retention` and `backup_ro`, created by a test-only setup migration mirroring SEC-10.

## 4. Fixture catalog

Each fixture has a named consumer; a fixture with no consumer should not exist. **All fixtures are fictional** (decided 2026-09-14) — no real company or person is committed to this public repository. Every entry below is asserted in `src/server/db/seed/seed.test.ts`.

| Fixture | Consumed by |
|---|---|
| Undisclosed round | `formatAmount`; DM-06 check; timeline render; CSV validation |
| **EUR round with fx rate** | FR-406 conversion; `Round` DTO fx fields; totals |
| **Round in a currency absent from `fx_rates`** | `422` for editors; admin manual rate path |
| **Debt, grant and secondary rounds on one startup** | `total_raised_usd` excludes them; `total_debt_usd` = debt only |
| Acquired company, acquirer in DB / name only | header render; DM-02 check |
| Company in two batches | many-to-many; badges |
| **Founder across 3 startups, one with two stints at the same company** | founder ordering; DM-10 uniqueness allows it; graph E2E |
| Investor across 5 rounds, leading 2 | portfolio pagination; rounds-led; breakdown |
| **Investor linked with `round_id = NULL`** | duplicate insert rejected (`NULLS NOT DISTINCT`) |
| Company with no founders / no rounds | empty states |
| **One `draft` and one `archived` per entity** | authz suite; cached-read leak tests |
| **Archived record that was previously published** | public 404; restore; hard delete refused |
| **Never-published draft** | admin hard delete allowed |
| **Slug redirect (old → current)** | 301 on page and API |
| Facet value with no `taxonomy_pages` row but ≥ 5 companies | generated copy, indexable |
| **Facet value with 3 companies** | `isIndexable: false`, excluded from sitemap |
| **Facet value with 0 published companies** | 404 |
| Near-identical company names | CSV trigram duplicate detection |
| **Staging media asset older than 24 h; unreferenced attached asset older than 7 days** | media GC |
| **Audit rows older than 90 days and 12 months** | retention job |
| Names with diacritics and non-Latin scripts (Zürich, São Paulo, 東京) | slug transliteration; `simple` FTS; trigram search |

## 5. Unit tests

| Module | Assertions |
|---|---|
| `lib/slug` | transliteration via unaccent semantics; punctuation; collision suffix |
| `lib/money` | `$30M`, `$550M`, `$1.2B`, `Undisclosed`, `null`; bigint only |
| `lib/fx` | rate on the announcement date; falls back to latest prior business day; none available → error; rounding to whole USD |
| `lib/cursor` | round-trip; HMAC tamper → reject; cursor minted for `sort=raised` rejected for `sort=name`; depth counter |
| `lib/ip` | reads the platform-trusted IP; a client `X-Forwarded-For` is ignored (SEC-14) |
| `lib/origin` | admin origin accepted; public origin, missing origin (without `Sec-Fetch-Site: same-origin`) and foreign origins rejected |
| `lib/safe-fetch` IP classifier | every range in SEC-05, including IPv4-mapped IPv6 (`::ffff:127.0.0.1`), decimal (`2130706433`) and octal (`0177.0.0.1`) forms |
| `dto/*` | no `created_by`, `updated_by`, audit fields, blob prefixes or internal ids |
| CSV parse / export | per-field errors; raw storage; formula neutralization **only in export** |
| audit diff builder | personal-data fields recorded as `{ field, changed: true }` with no values |

## 6. Integration tests — services

Every read: correct rows, complete ordered relations, DTO shape, and **draft/archived excluded for public contexts**.

| Service | Key assertions |
|---|---|
| `startups.getBySlug` | full graph; ≤ 3 round-trips on a miss (NFR-01); unknown/draft/archived → `NotFoundError`; old slug → redirect result |
| `startups.list` | every facet; combined facets; acquired excluded by default; **each sort paginates without duplicates or gaps while rows are inserted mid-pagination** |
| `founders.getBySlug` | 3 startups incl. two stints, `joined_year DESC` |
| `investors.getPortfolio` | distinct companies; pagination; rounds-led = 2 |
| `batches.getStats` | count, raised sum (equity + convertible only), top 5 industries |
| `rounds` writes | EUR conversion stored with rate/date/source; totals recomputed in-transaction; debt/grant/secondary excluded |
| `taxonomy.getPage` | real value without copy → generated; nonexistent value → `NotFoundError`; < 5 companies → not indexable |
| `search` | exact name first; FTS on tagline/description; trigram finds a misspelling and a diacritic-stripped query; drafts never returned |
| lifecycle | DELETE archives; restore; hard delete refused after first publish, allowed for never-published; slug change writes a flattened redirect |
| `privacy.eraseFounder` | founder, joins and media removed; related audit rows scrubbed; `erasure_log` row with hash only; caches expired |
| `prefill` | a page with JSON-LD, OpenGraph, icons and social links yields name, tagline, description, careers URL, links and a matched location; the careers link prefers the company's own host, accepts a hiring platform, and is left empty rather than pointing at a third party; images become staging assets with `source_url`; a hostile `og:image` or Firecrawl image URL is skipped with a warning and no resolved address in it; a non-raster icon skipped; 403/500 pages degrade to warnings; Firecrawl used only when the page gave nothing, absent key degrades; no entity is ever persisted; 20 per hour then `429`, and a limiter outage refuses (fails closed) |
| `import` | the dry run plans create/update/skip/error rows, reports new founder and investor names, ignores unknown columns and a byte-order mark; commit creates drafts with industries, founders and investors, reusing existing records; an explicit slug updates; every refusal writes nothing |
| `media` | widths per purpose; no upscaling; blur placeholder is a WebP data URL; share card rendered, record repointed, previous card and blobs deleted; GC keeps fresh uploads and referenced assets, deletes staged > 24 h and unreferenced > 7 days |
| `import` | dry-run stores rows + SHA-256; commit uses stored rows; a conflicting record created between dry-run and commit → `IMPORT_STALE`, zero rows written; > 24 h → `IMPORT_EXPIRED` |
| caching | after a write with `revalidateTag(tag, { expire: 0 })`, the next public read returns fresh data (no stale serve) |

Every write service: happy path, rollback on failure, derived fields, audit row, cache tags expired, slug conflict → `ConflictError`.

## 7. Authz conformance suite *(SEC-03, NFR-10)*

`src/server/services/authz.test.ts` (harness in `src/server/testing/authz.ts`, itself proven against a conforming stub and a deliberately broken fixture service) — table-driven, enumerating every exported function in `src/server/services/**` and `src/server/cache/**`.

```
for each READ service function:
  ├─ publicContext()          → excludes draft and archived fixtures
  └─ authedContext(editor)    → includes the draft fixture

for each CACHED public read (src/server/cache/**):
  ├─ PUBLIC_READ              → excludes draft and archived fixtures
  ├─ called with authedContext(editor) at runtime (type-cast) → throws
  └─ called with publicContext(ip) at runtime (type-cast)     → throws
     (the parameter type already makes both a compile error; this proves the runtime guard)

for each ADMIN-PANEL READ (editor-read — src/server/services/admin-reads.ts):
  ├─ publicContext(), PUBLIC_READ, forged → throws ForbiddenError
  └─ authedContext(editor/admin)          → sees the draft fixture

for each MUTATION:
  ├─ publicContext()          → throws ForbiddenError
  └─ authedContext(editor)    → succeeds

for each ADMIN-ONLY mutation (hard delete, slug change, users, privacy, manual FX):
  └─ authedContext(editor)    → throws ForbiddenError

registry completeness:
  └─ every exported function appears in exactly one table → else FAIL naming it
```

Kinds: `read`, `editor-read`, `cached-read`, `mutation`, `admin-mutation`. Admin-only reads (staff accounts, privacy requests) are registered as `admin-mutation`, whose contract — refuse everyone up to and including an editor, admit an admin — is exactly what they need.

`user_role` has only `admin` and `editor`; "wrong role" is tested as *editor attempting an admin-only action*.

A compile-time check (`tsd` / `expectTypeOf`) asserts that a function in `src/server/cache/**` does not accept `RequestContext`.

## 8. Security test matrix

| ID | Test | Must observe |
|---|---|---|
| SEC-01 | `check-bundle-leak.ts` on built client chunks, with real secret values injected in CI | zero occurrences of any server secret value or `postgres(ql)?://` |
| SEC-02 | Contract tests with malformed and extra-field bodies | 400 with field details; no DB query issued |
| SEC-03 | Authz conformance suite (§7) | green, registry complete |
| SEC-04 | `auth.spec.ts` (Playwright) + contract tests | session cookie host-only on admin origin, httpOnly, Secure; login without completed 2FA → 401 on writes; recovery code works once; revoked session rejected immediately; cross-origin POST (Origin: public origin, and a foreign origin) → 403; `text/plain` body → 415; write path on public origin → 404 |
| **SEC-05** | `src/server/lib/safe-fetch.test.ts`, `src/server/services/prefill.test.ts` and `src/app/api/v1/prefill-endpoint.test.ts`: `http://…` (non-https); `https://localhost`; `https://127.0.0.1`; `https://[::1]`; `https://[::ffff:127.0.0.1]`; `https://10.0.0.1`; `https://172.16.0.1`; `https://192.168.1.1`; `https://100.64.0.1`; `https://169.254.169.254/latest/meta-data/`; `https://2130706433/`; `64:ff9b::a00:1` (NAT64 wrapping a private IPv4) refused while `64:ff9b::4c4c:1516` (NAT64 wrapping a public one) is allowed; a mixed answer hands over only its public addresses; **DNS rebinding mock** (first resolution public, second private); a public page **redirecting** to a private IP; a 4-hop redirect chain; a 50 MB body; a 30 s hanging server; **a public page whose `og:image` points at `169.254.169.254`**; **a Firecrawl mock returning a private-IP image URL** | every one rejected; the page-level cases return `400 UNSAFE_URL`; the image-level cases return `200` with the image omitted and a warning; no socket to a private address is ever opened (asserted via the connect hook) |
| SEC-06 | `src/server/services/media.test.ts` and `src/app/api/v1/media-endpoint.test.ts`: PNG renamed `.jpg`; 6 MB file; **a 175-byte PNG whose header claims 50,000 × 50,000 px**; EXIF+GPS JPEG; SVG plain, with a script, and with a remote `href`; polyglot GIF/JS; HTML; random bytes | sniffed type wins and output is WebP; 413 before the bytes are read; **422 IMAGE_TOO_LARGE from the header, nothing decoded**; EXIF absent from the stored variant; every SVG and non-allowlisted file rejected 415; each asset under its own random prefix, identical bytes never sharing a path |
| SEC-07 | `src/server/services/import.test.ts` and `src/app/api/v1/import-endpoint.test.ts`: 1,001 rows; a `=HYPERLINK(…)` cell and a `=cmd|…` name; commit of a job nobody ran; commit after a competing insert; commit after the record was edited; commit after 24 h; an industry deleted between dry run and commit | cap enforced; values stored raw and neutralized only in `export.csv`; `404`, `IMPORT_STALE`, `IMPORT_EXPIRED`, `CONFLICT` and `422` as specified; the startup count is unchanged and the job stays `dry_run` after every refusal |
| SEC-08 | Rate-limit integration tests + WAF config review | 121st write / min by one staff account → 429 with `Retry-After`, and a limiter outage still allows writes (fails open); 21st login attempt / 15 min from one IP → 429; 6th failure for one email → delayed response, **account still usable from another IP after the delay** (no lockout); 21st prefill / hour → 429; Upstash unavailable → login and prefill fail closed; WAF rules exist for `/api/v1/*` |
| SEC-09 | `headers.spec.ts` against a production build, both origins | admin: nonce CSP with `strict-dynamic`, nonce differs per request; public: SRI hash CSP (or documented fallback) and page still statically cached; HSTS **without** `preload`; nosniff; Referrer-Policy; X-Frame-Options DENY |
| SEC-10 | Role tests | `app_rw`: `CREATE TABLE` denied, `UPDATE audit_log` denied; `retention`: can only touch `audit_log`; `backup_ro`: writes denied; migrator credential absent from Vercel env listing (checklist) |
| SEC-11 | `audit.spec.ts` + retention job test | every mutation audited; personal fields have no values; job nulls IPs > 90 days and deletes rows > 12 months; app code has no UPDATE/DELETE path on `audit_log` |
| SEC-12 | Forced 500 | no stack, SQL, table name or internal id in body; detail in Sentry with PII scrubbed |
| SEC-13 | CI + `pnpm-workspace.yaml` review | frozen lockfile; `strictDepBuilds: true` and only `allowBuilds`-listed packages run build scripts; `minimumReleaseAge: 4320`; audit exceptions all carry owner + expiry; weekly `audit.yml` run succeeds |
| SEC-14 | `ip.spec.ts` | spoofed `X-Forwarded-For` does not change the rate-limit key or the audited IP |
| SEC-15 | Contract tests | 21st anonymous page → `PAGINATION_DEPTH`; `limit=500` clamped to 48; public DTOs contain no admin-only fields; `robots.txt` disallows `/api/` |
| SEC-16 | Deployment checklist | preview DB is a branch of the seed branch (no production rows); preview URL requires Vercel Authentication; production secrets not present in Preview scope |
| SEC-17 | `restore-test.yml` (monthly) | latest R2 dump decrypts, restores into a scratch branch, row counts match production within the dump window; failure alerts |
| SEC-18 | Launch checklist + `privacy.eraseFounder` integration test | `/privacy` live and reviewed; erasure test above green; seed contains no photos without a recorded licence/source |
| SEC-19 | Post-launch checklist | preload submitted only after 3 months of stable HTTPS on all subdomains |
| SEC-20 | Monthly repo-settings check via `gh api` + workflow lint in CI | secret scanning, push protection, Dependabot alerts and security updates enabled; `main` protected with required checks; every `uses:` pinned to a 40-character SHA; every workflow declares `permissions`; no `pull_request_target`; fork workflows require approval; `production` environment has a required reviewer; no `.env`, dump or watermark file tracked by git |

## 9. API contract tests

For every endpoint in [API.md](./API.md): success shape, status, envelope and each failure mode listed there.

- Unknown slug → 404; **draft/archived → 404 for public callers**; **old slug → 301 with correct `Location`**.
- **Nonexistent facet value → 404**; thin facet → `isIndexable: false`.
- Write paths on the public origin → 404; cross-origin writes → 403.
- Cursor: tampered → 400; sort mismatch → 400; depth > 20 anonymous → 400; results stable under concurrent inserts for each sort.
- Rounds: `amountUsd` in a create body → 400 (unknown/forbidden field); undisclosed with amount → 422; EUR create → response carries server-computed fx fields.
- Every response validated against a Zod schema generated from the documented DTO, so a field rename fails the test, not the frontend.

Reads: `src/app/api/v1/read-endpoints.test.ts` calls each route handler as Next.js does and validates bodies against strict schemas in `src/server/testing/contract.ts`, so an undocumented field — including any admin-only one — fails (SEC-15). Cursor stability is checked by publishing a company between two page requests for each sort. Wrapper behaviour (SEC-12 forced 500, SEC-14 spoofed headers, envelopes) is unit-tested in `src/server/http/handler.test.ts`.

Writes: `src/app/api/v1/write-endpoints.test.ts` signs in real users who completed TOTP (and one who did not) and covers, per SEC-04: the check order (origin 403 and content type 415 even with a valid session, then 401 and 403), the public-origin 404 through `proxy.ts`, malformed/unknown/oversized bodies, and each lifecycle, slug, relationship, category and privacy endpoint end to end, reading public pages back where a write changes them. Test users who wrote audit rows are kept and signed out, since audit history keeps its actor.

Admin reads and staff accounts: `src/app/api/v1/admin-endpoints.test.ts` — an admin list shows the draft and archived fixtures while the public grid on the same path does not; `status` and `q` filter (a `%` search matches nothing, proving the term is a literal); an admin record carries `values`, `derived` and `links` and never `status` among its values; an unknown or non-uuid id is 404; `/founders` off the admin origin is 404. Staff accounts: editors are refused (403); an invite emails a one-hour link whose token sets a password, after which the account is still only `enrollment-required` (FR-201); re-invites re-send; a role change, a two-factor reset and a deactivation each end that user's session; a deactivated account's sign-in response is byte-for-byte a wrong-password response; self-demotion and self-deactivation are 422; reactivation restores the account. The write budget: the 121st write in a minute by one account is 429 with `Retry-After`.

## 10. E2E scenarios (Playwright)

| Spec | Scenario | Asserts |
|---|---|---|
| `graph.spec.ts` | `/` → company → founder → *earlier* startup → investor → portfolio → another company → batch → cohort | every hop by click, no dead ends |
| `admin-crud.spec.ts` | login + TOTP on `admin.localhost` → create startup with 2 founders (1 inline), 3 investors, a batch, a EUR round → publish | appears on `/`, its page, both founder pages, investor page, `/news` with original currency shown |
| `lifecycle.spec.ts` | archive a published company → visit publicly → restore → admin changes slug → visit old URL | 404 while archived; visible after re-publish; old URL 301s to new |
| `auth.spec.ts` | first login forces 2FA enrollment; recovery code; session revocation; cross-origin form POST from the public origin | enrollment required; code single-use; revoked immediately; POST rejected |
| `access-control.spec.ts` | anonymous `/admin` on admin host; `/admin` on public host; draft slug publicly; editor on `/admin/users` | redirect to login; 404; 404; 403 |
| `editorial.spec.ts` | prefill with a mocked page; prefill with `169.254.169.254`; prefill page with hostile `og:image`; CSV dry-run then commit; CSV commit after a conflicting edit | populates as draft with staged images; rejected; image omitted with warning; commit succeeds; `IMPORT_STALE` shown |
| `categories.spec.ts` | real facet, thin facet, random slug | renders; `noindex` meta present; 404 |
| `search.spec.ts` | ⌘K; misspelling; diacritic-free query for "Zürich"-based company; type tabs | keyboard-only; found; found; filtered |
| `responsive.spec.ts` | 360 / 768 / 1280 px on `/`, company, admin form | no horizontal scroll; filters in sheet on mobile |

## 11. Non-functional testing

| Requirement | Method | Target |
|---|---|---|
| NFR-01 | Lighthouse on preview; query-count assertion | LCP ≤ 2.0 s p75; cached TTFB ≤ 400 ms; suggest p95 ≤ 150 ms; ≤ 3 round-trips per miss |
| NFR-02 | **Vitest** (`src/server/cache/cache.test.ts`, with `next/cache` replaced by a recording double): every cached read sets explicit tags and `cacheLife`, returns plain JSON, rejects malformed input before the cache; static scan proves no cached scope takes a context or reads request data. **Production build** (Phase 22 preview): two sequential reads from different clients; write then read | tags and lifetimes as specified; one DB execution for both reads; no stale read after write |
| NFR-03 | Rich-results test; sitemap diff after publish; thin facet check | valid JSON-LD; new entity in sitemap; thin facets `noindex` and absent from sitemap |
| NFR-04 | axe in CI; manual keyboard + screen reader pass | zero violations; initials avatars labelled |
| NFR-05/06 | `responsive.spec.ts`; manual theme pass | no horizontal scroll; both themes legible |
| NFR-07 | Force an error on preview | Sentry event with request id and no PII |
| NFR-08 | Integration | exact bigint sums; FX recorded per round; atomic multi-table writes |
| **NFR-11** | Vercel usage dashboard on preview after a full crawl of the seed site; code review | **image transformations = 0**; grid links use hover prefetch; OG served from Blob; budget alerts configured |
| NFR-12 | Launch checklist | Vercel Pro and Neon Launch active before public launch |

## 12. Ops tests

| Job | Test |
|---|---|
| `migrate.yml` | runs only on `main` in the protected environment; a deliberately failing migration stops promotion; the previous deployment still works against the migrated schema (expand-only check) |
| `backup.yml` | produces an encrypted object in R2; object is not readable without the offline key |
| `restore-test.yml` | see SEC-17 |
| retention | see SEC-11 |
| media GC | stale staging and unreferenced assets deleted; attached assets untouched |
| FX import | ECB feed mock imported; weekend/holiday dates resolve to the prior business day |

## 13. Pre-release manual checklist

- [ ] Add a company end to end in **under 90 seconds**, timed (PRD §10)
- [ ] Keyboard-only pass over `/`, a company page, `/search`, the admin startup form
- [ ] Screen-reader spot check on a company page and the admin form
- [ ] Light and dark on every page type; 360 px phone pass
- [ ] Draft and archived companies invisible in a private window
- [ ] Published company appears in `/news`, `/`, its category pages and the sitemap
- [ ] Prefill on five real company URLs — record what it gets wrong (`pnpm try:prefill <url> …` prints what was extracted, with no sign-in needed)
- [ ] Import the fixture CSV; commit; verify drafts
- [ ] 404 and 500 pages
- [ ] Revoke a session; confirm immediate logout
- [ ] Restore the latest backup into a scratch branch by hand once
- [ ] Budget alerts fire on a test threshold
- [ ] `/privacy` and `/about` reviewed

## 14. CI pipeline

```
install (--frozen-lockfile) ─▶ lint ─▶ typecheck ─▶ unit
   ─▶ integration + authz + contract (Postgres 17 service)
   ─▶ build ─▶ check:leak ─▶ pnpm audit (with exceptions)
   ─▶ e2e (from Phase 18) ─▶ axe (from Phase 20) ─▶ coverage gate

separate workflows: migrate.yml (main, protected) · backup.yml · restore-test.yml · maintenance.yml
```

## 15. Coverage

- ≥ 80% lines on `src/server/services`; 100% of mutations and cached reads in the authz suite.
- Excluded: generated migrations, `src/components/ui/*`, config, seed scripts.
- Coverage is a floor. The authz and SSRF suites are worth more than the percentage.

## 16. Bug severity

| Severity | Definition | Response |
|---|---|---|
| **S1** | Data leak (draft/archived visible publicly, draft in shared cache), authz bypass, SSRF, CSRF, credential or secret exposure, unrecoverable data loss | Stop work; fix; add regression test |
| S2 | Wrong data (incorrect totals or FX, wrong founder link), broken write path, failed backup | Fix before the next phase |
| S3 | Broken layout, missing empty state, a11y violation | Fix within the phase |
| S4 | Cosmetic, copy | Backlog |

Every S1/S2 fix ships with the regression test that should have caught it.

## 17. Definition of done (per phase)

A phase in [../TODO.md](../TODO.md) is done when every box is checked, its EXIT condition holds, tests for its requirement IDs exist and pass, CI is green, and no S1/S2 bug is open against it.

---

**See also:** [PRD.md](./PRD.md) · [SRS.md](./SRS.md) · [API.md](./API.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [../TODO.md](../TODO.md)
