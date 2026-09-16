# startupsHQ — Documentation

**Last updated:** 2026-09-16

Read in this order. Each document answers a different question; they cross-reference rather than repeat.

| Document | Question it answers | Authority on | Read it when |
|---|---|---|---|
| [PRD.md](./PRD.md) | **What** are we building and **why**? | Scope, users, success metrics | Deciding whether to build something |
| [SRS.md](./SRS.md) | **What exactly** must be true? | Schema, authorization, security (`SEC-*`), performance and cost budgets (`NFR-*`) | Writing any code |
| [API.md](./API.md) | **What is the contract?** | Endpoint paths, params, DTO shapes, status and error codes | Building or consuming an endpoint |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | **How is it put together, and why?** | Layering, lifecycles, caching, ops, cost model, Decision Records (ADR-001 … ADR-021) | Before changing anything structural |
| [TEST_PLAN.md](./TEST_PLAN.md) | **How do we know it works?** | Quality gates, fixtures, security test matrix | Writing tests; judging whether a phase is done |
| [../TODO.md](../TODO.md) | **What's next?** | Build sequence, backend before frontend | Every working session |

If SRS and API.md disagree, SRS states the requirement and API.md must be corrected to satisfy it.

## Requirement IDs

SRS.md assigns stable IDs — `FR-*` functional, `SEC-*` security, `NFR-*` non-functional, `DM-*` data model. TODO tasks and TEST_PLAN tests reference them:

```
PRD (a need) ─▶ SRS (FR-102) ─▶ TODO (a task citing FR-102) ─▶ TEST_PLAN (a test asserting FR-102)
```

Code you can't trace to an ID is either missing an ID or unrequested.

## How to change these documents

Keeping them accurate matters more than keeping them stable. Changes propagate **downstream** so the set never contradicts itself:

```
PRD  ──▶  SRS  ──▶  API  ──▶  ARCHITECTURE  ──▶  TEST_PLAN  ──▶  TODO
why       what      contract    how             proof         sequence
```

**Changing scope or a feature:** PRD §7 (and §10 if metrics change) → `FR-*` in SRS → API.md if an endpoint changes → verification in TEST_PLAN → task in TODO.

**Changing the schema or an API contract:**
1. Update `DM-*` / `FR-*` in SRS.
2. Update API.md. After TODO Phase 8 it is frozen: additive changes stay in `v1`; breaking changes need `/api/v2` (API.md §9).
3. Update ARCHITECTURE §4 if a traversal or query pattern changes.
4. Update fixtures and tests in TEST_PLAN.
5. Generate a migration. **Never hand-edit a committed migration.** Migrations must be backward-compatible with the deployed code (ADR-015).

**Changing an architectural decision:**
1. **Add a new ADR** in ARCHITECTURE §10 that supersedes or amends the old one. Never rewrite an accepted ADR — its rejected alternatives are the valuable part.
2. Update only the old ADR's `Status` line (`Superseded by ADR-0NN` / `Amended by ADR-0NN`).
3. Propagate to SRS, API, TEST_PLAN, TODO.

Each ADR carries a **Revisit if** line naming the condition that should reopen it.

**Changing security requirements:** `SEC-*` may be strengthened freely. Weakening one requires an ADR with rationale and a named replacement verification in TEST_PLAN — never a silent deletion.

**Marking uncertainty:** tasks that depend on something not yet verified are marked `[?]` in TODO and must record their outcome back into SRS when resolved.

## Revision history

| Date | Change |
|---|---|
| 2026-09-12 | v1: PRD, SRS, API, ARCHITECTURE (ADR-001…011), TEST_PLAN, TODO |
| 2026-09-14 | v2: full review against Next.js 16, Vercel, Neon, Upstash and Better Auth docs. Added ADR-012…020; cache-safe public reads; admin subdomain + split CSP; SSRF rebinding and image-URL defence; mandatory 2FA; CSRF origin checks; trusted client IP; archive-not-delete; off-provider backups; migrations out of the build; FX conversion and "total raised" definition; slug redirects; CSV commit integrity; media staging + GC; facet 404/noindex rules; GDPR handling; supply-chain hardening; paid tiers at launch; doc inconsistencies fixed |
| 2026-09-14 | Repository made public: ADR-021 and SEC-20 (public-repo hygiene). pnpm 12 supply-chain settings confirmed from pnpm docs (`strictDepBuilds`, `allowBuilds`, `minimumReleaseAge: 4320`), resolving the Phase 0 `[?]` |
| 2026-09-14 | Phase 3 as built: slug/money are client-safe in `src/lib`; FR-403 names without Latin characters need a manual slug; FR-406 rate window is ≤ 7 days, never later; authz harness path in TEST_PLAN §7; `attachDatabasePool` added to Phase 22 |
| 2026-09-14 | Phase 4a: API §6.1 `q` on `/startups` is a filter, not a ranking (ranking would break keyset pagination; `/search` ranks). Drizzle `relations.ts` dropped from TODO Phase 4: explicit joins keep a visibility predicate on every hop |
| 2026-09-14 | Phase 4c: API §6.10a `GET /categories` directory added; §6.10 documents category slugs (hyphenated enums, country-level location rows) and that acquired companies count |
| 2026-09-14 | Phase 4d: TEST_PLAN NFR-02 split into Vitest checks (tags, lifetimes, key safety via a `next/cache` test double) and a production-build check of real cache sharing. TODO Phase 22 gains "verify `'use cache'` persistence on Vercel", since Next.js documents that the default in-memory store usually does not persist across serverless instances |
| 2026-09-15 | Phase 5b: API §8.1 round participants are `investors: [{ investorId, isLead }]` (lead status feeds "rounds led"); manual FX rates are refused when an ECB rate exists; round PATCH leaves participants to §8.3 |
| 2026-09-15 | Phase 5c: API §8.3 link removal addresses one link by id (`DELETE /startups/{id}/founders/{linkId}`, `/investors/{linkId}`, `/batches/{batchId}`), since a founder can hold several stints at one company; `POST` returns the link id |
| 2026-09-15 | Phase 5e: SRS §4.12 adds `privacy_requests` and the `scrub_founder_audit` SECURITY DEFINER function (migrations 0003, 0004); API §8.9 gains `PATCH /privacy/requests/{id}` and the erase response shape |
| 2026-09-15 | Phase 5f: cache invalidation neighbours (ARCHITECTURE §5) extended — a startup write also expires the pages of companies it acquired and their founders, investors and batches, because those cards name the acquirer. Found by the new cache-freshness test |
| 2026-09-15 | Phase 6a: SRS SEC-04 records the cookie spike (`__Host-startupshq.*` works; sessions in Postgres only); SEC-08 records the limiter as built (fail closed as `429` + `Retry-After: 60`, 2FA account lockout disabled, local Redis + serverless-redis-http). Decisions: Resend for email; Redis + SRH containers for local/CI limits |
| 2026-09-15 | Phase 6b: API §1 "Origins" documents host routing as built in `src/proxy.ts` — unknown hosts are public, admin host limited to `/admin`, `/api/auth`, `/api/v1`, `X-Robots-Tag: noindex` there. Phase 6 complete; session rotation on role change and invite/2FA-reset emails move to the users service |
| 2026-09-15 | Phase 7: API §1 — a single-valued query param given twice is `400`; sub-resources answer only to the current slug. §6.8 and §6.10 name `GET /startups` as the source of later cohort and category pages. TEST_PLAN §9 records where the read contract tests live. Phase 7 complete |
| 2026-09-16 | Phase 8b/8c: API §7.10 adds `AdminListItem`/`AdminRecord` (admin origin only, `values` mirrors what PATCH accepts); §8.1 documents the admin list and record; §8.8 documents staff accounts as built, including `POST /users/{id}/reactivate`; §5 records that the per-account write budget fails open. SRS SEC-04 (session rotation on privilege change), SEC-08 (write budget) and FR-208 updated; TEST_PLAN §7 gains the `editor-read` harness kind. Migrations 0005 (`users.deactivated_at`) and 0006 (audit actions). **v1 contract frozen** |
| 2026-09-15 | Phase 8a: API §8 states the order of checks, the 256 KB JSON body cap (`413`), `Cache-Control: private, no-store`, the write response shapes, `204` for industries and category copy, and that writes put the id where public reads put the slug. TEST_PLAN §9 records the write contract tests |
| 2026-09-14 | Decisions: direct pushes to `main` with required CI (fix red runs immediately); no license — all rights reserved |
| 2026-09-14 | Phase 0 complete. Dependabot cannot update pnpm 12 lockfiles: npm removed from Dependabot, weekly full-lockfile audit added; npm version updates by monthly manual review |
| 2026-09-14 | Phase 1 complete: 23-table schema, NOLOGIN group roles with append-only audit privileges, constraint and privilege tests. A drizzle-kit bug (CHECK SQL truncated at `;`) was found in review and is now guarded by a test |
| 2026-09-14 | Seed data is fictional only (public repo). Derived totals count published rounds only, so unpublished amounts cannot leak. `seed-admin` moved to Phase 6 |

## Conventions

- Update `Last updated` in any document you touch.
- Prefer tables and requirement IDs; prose drifts.
- One fact, one home — link instead of repeating.
- Record open questions (PRD §12) rather than guessing.
