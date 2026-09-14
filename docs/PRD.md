# startupsHQ — Product Requirements Document

**Status:** Draft v2 · **Last updated:** 2026-09-14 · **Owner:** Sanskar

---

## 1. Vision

A startup directory where the **relationships** are the product.

Most startup databases are searchable lists of companies. startupsHQ treats startups, founders, investors and accelerator batches as one connected graph, so every page is a doorway into the rest of the data. You arrive looking up one company and leave having traced a founder's three previous ventures, the fund that backed all of them, and that fund's other bets.

> "Every page is an entry point, and no page is a dead end."

## 2. Problem

| Who | Problem today |
|---|---|
| Founders raising | Finding which investors actually fund their stage/sector/geography means stitching together Twitter, press releases and paywalled databases. |
| Job seekers | Startup job boards show the role but not the company's credibility — who funded it, who's running it, how much runway it likely has. |
| Analysts & journalists | Tracing a founder's history, or an investor's portfolio concentration, requires many manual searches. |
| Enthusiasts | No pleasant, browsable way to explore who is building what, and with whom. |

Existing tools sit at two extremes: expensive enterprise databases (Crunchbase, Tracxn, PitchBook) that are gated and unpleasant to browse, or free curated galleries that are lovely but shallow — flat company lists with no people and no cohorts.

## 3. Differentiation

Primary reference is [startups.gallery](https://startups.gallery) — excellent taste, minimal UI, curated. We adopt its visual restraint and URL structure. We beat it on depth:

| Capability | startups.gallery | Crunchbase | **startupsHQ** |
|---|---|---|---|
| Company profiles | ✅ | ✅ | ✅ |
| Investor profiles + portfolio | ✅ | ✅ | ✅ |
| **Founder profiles as first-class pages** | ❌ | Partial, gated | ✅ **core** |
| **Founder → all their ventures over time** | ❌ | Partial, gated | ✅ **core** |
| **Accelerator batches as an entity** (YC W24, a16z Speedrun) | ❌ | ❌ | ✅ **core** |
| Funding round timeline w/ source citation | Latest only | ✅ gated | ✅ full, cited |
| Free & pleasant to browse | ✅ | ❌ | ✅ |

**The two features nobody else gives away free: the founder graph and batch cohorts.** Everything else is table stakes we must simply do well.

## 4. Principles

1. **Minimal, sleek, fast.** Generous whitespace, few colors, real typography. Content is the design. No dashboard chrome.
2. **Depth over volume.** 500 richly-linked companies beat 50,000 stubs. Quality is the moat.
3. **Every fact is traceable.** Funding rounds cite the press article they came from; founder–company links record where the attribution came from.
4. **Never a dead end.** Every entity on a page is a link to another page.
5. **Correct over convenient.** If a fact isn't known, show nothing — never a guess, and never a fabricated record. "Undisclosed" is a valid, visible answer.
6. **Curated, not crowdsourced.** Editors enter data. No public submissions in v1.
7. **People are not products.** Founders are real people with rights over their data; we hold only professional facts, and honour correction and erasure requests.

## 5. Users

| Persona | Primary need | Entry point |
|---|---|---|
| **Priya — founder, pre-seed** | Which investors fund seed-stage fintech in India? | Investor pages, `/categories/*` |
| **Arjun — senior engineer job-hunting** | Is this startup well-funded and who's running it? | Company page → founders, rounds |
| **Maya — VC analyst** | What else has this founder built? Who co-invests with us? | Founder pages, investor portfolio |
| **Dev — journalist** | Verified funding facts with sources | `/news`, round citations |
| **Sam — startup watcher** | Browse what's new and interesting | `/`, `/news`, batch pages |
| **Editor (internal)** | Add a company in under a minute | Admin panel |

## 6. Core content model (product language)

- **Startup** — a company. Has a stage, location, industries, work type, size, founders, investors, possibly batches, a timeline of funding rounds, and possibly an acquisition.
- **Founder** — a person. Has a headline, bio, links, and a history of startups with roles and tenure — including leaving and returning. *A founder can appear across many startups — this is the point.*
- **Investor** — a fund, accelerator, angel, or corporate arm. Has a portfolio and rounds it led.
- **Batch** — a specific accelerator cohort (Y Combinator W24, a16z Speedrun S25). Belongs to an investor; contains many startups. A startup may be in several.
- **Funding round** — an event: type, amount in its original currency (converted to USD at the announcement-date rate), date, valuation, participating investors, lead, and a source URL.
- **Total raised** — the sum of equity and convertible rounds only. Debt is shown separately; grants and secondary sales appear in the timeline but never inflate the total.
- **Category** — any browsable facet: industry, stage, work type, city, country.

## 7. Features — v1

### Must have
- **Explore grid** (`/`) — company cards with cover, logo, name, tagline, industry · stage · work type · city. Facet filters and sorts. "Load more".
- **Company page** — full profile, founders strip, "Backed by" investor logos, batch badges, funding timeline, totals, similar companies.
- **Founder page** — photo (only when founder-supplied or licensed; otherwise initials), bio, links, and every startup with role and tenure.
- **Investor page** — bio, full portfolio grid, rounds led, stage/industry breakdown.
- **Batch page** — cohort grid, batch stats (company count, total raised, top industries).
- **Category pages** — `/categories/{industries,stages,work-type,locations/cities,locations/countries}/[slug]`, each with editable copy and SEO text; only for facets that actually have companies.
- **News feed** (`/news`) — funding rounds newest-first, grouped by date, each citing its source.
- **Search** — across startups, founders, investors, batches, with fuzzy matching on names in any language.
- **Admin panel** — on its own admin subdomain; login with mandatory two-factor authentication; full CRUD for all five entity types; draft → published workflow; archive and restore instead of permanent deletion.
- **Paste-URL prefill** — paste a company or funding-article URL, get the form pre-filled for review.
- **CSV bulk import** — with mandatory dry-run preview and duplicate detection.
- **Stable URLs** — renaming a company keeps its old URL working via a permanent redirect.
- **SEO** — server-rendered, per-page metadata, pre-rendered OG images, sitemap, structured data.
- **`/about` and `/privacy`** — data sourcing, corrections and takedown policy; what personal data we hold and how to request access, correction or erasure.

### Should have
- Dark mode · similar-companies recommendations · investor co-investment view · keyboard-driven search (⌘K) · image blur placeholders.

### Could have (post-v1)
- Founder alumni networks ("YC W24 founders' next companies") · funding trend charts · saved searches · scheduled logo refresh with editor review.

### Won't have in v1
Jobs board · public user accounts, follows, watchlists · automated scraping crawlers · paid data providers · newsletter · public API for third parties · public submission forms.

## 8. Key journeys

**Graph traversal (the core loop)**
`/` → Highstock → founder *Jane Doe* → her earlier startup *Acme* → investor *a16z* → a16z portfolio → *Rogo* → YC W24 batch → cohort grid. Every hop is one click, no dead ends, no search box required.

**Investor research (Priya)**
`/categories/locations/countries/india` → filter stage = Seed, industry = Fintech → open three companies → note the repeated investor → that investor's page → confirm they lead seed fintech rounds → visit their site.

**Editorial entry (Editor)**
Admin login with 2FA → new startup → paste company URL → prefill returns name, tagline, description, logo, cover, location → correct two fields → link two existing founders, create one new → add investors → add the Series A round (in its original currency) with its source article → Save as draft → preview → Publish. Target: **under 90 seconds** for a company with known data.

**Privacy request (a founder)**
Founder emails the privacy address asking to be removed → an admin records the request → verifies identity → runs erasure → confirms within 30 days.

## 9. Editorial workflow

Every entity has `draft | published | archived`.
- Drafts and archived records are invisible to the public — enforced in the data layer, not the UI.
- Prefill and CSV import always create drafts. **Nothing auto-publishes.**
- "Delete" archives a record so mistakes are reversible. Permanent deletion is admin-only and only for records that were never published — except privacy erasure, which is a separate, deliberate admin action.
- Every change is recorded in an audit log with actor, time and which fields changed; personal details are not copied into the log.
- Roles: **admin** (full, including users, slug changes, privacy requests) and **editor** (content only). Both require two-factor authentication.

## 10. Success metrics

| Metric | v1 target |
|---|---|
| Companies published | 300 at launch, 1,000 within 3 months |
| Countries represented at launch | ≥ 12, with no single country above 60% |
| Founders linked | ≥ 1.5 per company |
| Companies with ≥ 1 cited funding round | ≥ 80% |
| **Pages per session** (the graph is working) | **≥ 3.5** |
| Median time to add a company via admin | ≤ 90 s |
| Lighthouse performance / SEO on a company page | ≥ 95 / 100 |
| Largest Contentful Paint, p75 mobile | ≤ 2.0 s |
| Organic search traffic share by month 3 | ≥ 50% |
| Privacy requests resolved within 30 days | 100% |

## 11. Constraints & risks

| Risk | Mitigation |
|---|---|
| **Data entry is the real bottleneck** — a directory with 30 companies is not a product | Prefill + CSV import are v1 must-haves. Seed 300 before launch. |
| Founder data is the differentiator *and* the hardest to source | Accept partial founder records; a name + one link + its source still creates a graph edge. |
| **Founder data is personal data (GDPR and similar laws)** | Professional facts only; privacy notice and request process at launch; erasure path; audit log stores field names, not personal values; legal review before launch. |
| Logo and photo rights | Logos used nominatively for identification; founder photos only when supplied by the founder or licensed — initials otherwise; takedown path in `/about`. |
| Wrong attribution harms a real person's reputation | Every founder–company link records its source; corrections handled promptly via `/about`. |
| **Scrapers copy the curated graph** (the moat) | Edge rate limiting and bot challenges, limited pagination depth, minimal API responses, watermark phrasings to detect copies. Slowed and detectable, not preventable. |
| **Hosting costs at scale** | Pages cached and shared by all visitors; images pre-sized and served from storage; abuse blocked at the edge; budget alerts on every paid service. Paid hosting tiers required from public launch. |
| Scope creep toward a jobs board | Explicitly out of scope; schema doesn't block it later. |
| Stale funding data | `announced_on` + source URL always shown. |
| **Global scope spreads coverage thin** | Go deep per hub: seed the top ~12 startup cities (SF, NY, London, Bangalore, Berlin, Paris, Singapore, Tel Aviv, Toronto, Stockholm, Sydney, Tokyo) properly before adding a 13th. Facet pages with fewer than 5 companies stay out of nav and search indexes until they fill. |
| Accidental or malicious data loss | Archive instead of delete; 7-day database restore; nightly off-provider encrypted backups with monthly restore tests. |

## 12. Open questions

1. Do we display a "last verified" date per company? (Leaning yes, post-v1.)
2. ~~Should acquired companies stay in the default explore grid?~~ → **Resolved 2026-09-14:** hidden by default, with a toggle (API `include_acquired`).
3. ~~Geographic focus at launch?~~ → **Resolved 2026-09-12: global launch.** No geographic bias; country and city pages first-class; non-USD rounds handled correctly at launch.
4. ~~Do we need `/about` at launch?~~ → **Resolved 2026-09-14: yes — `/about` and `/privacy` are v1 must-haves**, because founder data is personal data under a global launch.
5. Final domain name for the public site and admin subdomain.

---

**See also:** [SRS.md](./SRS.md) · [API.md](./API.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [../TODO.md](../TODO.md)
