// Formatting is disabled for this file in biome.json: fixture tables stay one row per line so
// they can be reviewed at a glance. Lint rules still apply.
import "server-only";

import type {
  batches,
  founders,
  fundingRounds,
  fxRates,
  industries,
  investors,
  locations,
  startupFounders,
  startups,
  taxonomyPages,
} from "../schema";

// Fictional fixtures only (decided 2026-09-14). No real company, person or funding round appears
// in this public repository: every name, link and amount is invented, links use example.com,
// IPs use RFC 5737 documentation ranges, and FX rates are illustrative rather than ECB data.
// Each entry exists to serve a test in docs/TEST_PLAN.md §4.

type Insert<T extends { $inferInsert: unknown }> = T["$inferInsert"];
type Lifecycle = Pick<
  Insert<typeof startups>,
  "status" | "firstPublishedAt" | "archivedAt"
>;

const PUBLISHED = {
  status: "published",
  firstPublishedAt: new Date("2026-01-15T09:00:00Z"),
  archivedAt: null,
} satisfies Lifecycle;

const DRAFT = {
  status: "draft",
  firstPublishedAt: null,
  archivedAt: null,
} satisfies Lifecycle;

/** Archived after having been published — the common case for a removed record. */
const ARCHIVED = {
  status: "archived",
  firstPublishedAt: new Date("2025-02-01T09:00:00Z"),
  archivedAt: new Date("2026-01-10T09:00:00Z"),
} satisfies Lifecycle;

const site = (slug: string) => `https://${slug}.example.com`;
const person = (slug: string) => `https://example.com/people/${slug}`;
const news = (key: string) => `https://example.com/news/${key}`;

// ── Locations: 12 countries across 6 continents, with diacritics ─────────────────────────────

export const LOCATIONS: Insert<typeof locations>[] = [
  { slug: "san-francisco-us", city: "San Francisco", region: "California", country: "United States", countryCode: "US", lat: "37.774900", lng: "-122.419400" },
  { slug: "new-york-us", city: "New York", region: "New York", country: "United States", countryCode: "US", lat: "40.712800", lng: "-74.006000" },
  { slug: "london-gb", city: "London", region: "England", country: "United Kingdom", countryCode: "GB", lat: "51.507200", lng: "-0.127600" },
  { slug: "berlin-de", city: "Berlin", region: "Berlin", country: "Germany", countryCode: "DE", lat: "52.520000", lng: "13.405000" },
  { slug: "zurich-ch", city: "Zürich", region: "Zürich", country: "Switzerland", countryCode: "CH", lat: "47.376900", lng: "8.541700" },
  { slug: "paris-fr", city: "Paris", region: "Île-de-France", country: "France", countryCode: "FR", lat: "48.856600", lng: "2.352200" },
  { slug: "krakow-pl", city: "Kraków", region: "Lesser Poland", country: "Poland", countryCode: "PL", lat: "50.064700", lng: "19.945000" },
  { slug: "bengaluru-in", city: "Bengaluru", region: "Karnataka", country: "India", countryCode: "IN", lat: "12.971600", lng: "77.594600" },
  { slug: "tokyo-jp", city: "Tokyo", region: "Tokyo", country: "Japan", countryCode: "JP", lat: "35.676200", lng: "139.650300" },
  { slug: "singapore-sg", city: "Singapore", region: null, country: "Singapore", countryCode: "SG", lat: "1.352100", lng: "103.819800" },
  { slug: "sao-paulo-br", city: "São Paulo", region: "São Paulo", country: "Brazil", countryCode: "BR", lat: "-23.555800", lng: "-46.639600" },
  { slug: "lagos-ng", city: "Lagos", region: "Lagos", country: "Nigeria", countryCode: "NG", lat: "6.524400", lng: "3.379200" },
  { slug: "sydney-au", city: "Sydney", region: "New South Wales", country: "Australia", countryCode: "AU", lat: "-33.868800", lng: "151.209300" },
  // Country-level location (null city).
  { slug: "india", city: null, region: null, country: "India", countryCode: "IN", lat: null, lng: null },
];

// ── Industries ───────────────────────────────────────────────────────────────────────────────

export const INDUSTRIES: Insert<typeof industries>[] = [
  { slug: "ai", name: "AI" },
  { slug: "fintech", name: "Fintech" },
  { slug: "climate", name: "Climate" },
  { slug: "health", name: "Health" },
  { slug: "devtools", name: "Developer Tools" },
  { slug: "consumer", name: "Consumer" },
  { slug: "robotics", name: "Robotics" }, // exactly 3 published startups → thin facet
  { slug: "security", name: "Security" },
  { slug: "quantum", name: "Quantum Computing" }, // only a draft startup → 0 published
];

// ── Media ────────────────────────────────────────────────────────────────────────────────────

export type SeedMedia = {
  blobPrefix: string;
  purpose: "logo" | "cover" | "photo" | "og";
  state: "staging" | "attached";
  /** Created this many hours before the seed runs. */
  ageHours: number;
  attachedAgeHours?: number;
};

export const MEDIA: SeedMedia[] = [
  // Referenced by kiln-analytics.
  { blobPrefix: "fixtures/kiln-analytics-logo", purpose: "logo", state: "attached", ageHours: 72, attachedAgeHours: 71 },
  // Media GC fixtures (FR-408).
  { blobPrefix: "fixtures/stale-staging", purpose: "cover", state: "staging", ageHours: 48 },
  { blobPrefix: "fixtures/fresh-staging", purpose: "cover", state: "staging", ageHours: 1 },
  { blobPrefix: "fixtures/orphaned-attached", purpose: "logo", state: "attached", ageHours: 240, attachedAgeHours: 240 },
];

// ── Investors ────────────────────────────────────────────────────────────────────────────────

export type SeedInvestor = Omit<Insert<typeof investors>, "hqLocationId"> & {
  hq?: string;
};

export const INVESTORS: SeedInvestor[] = [
  { ...PUBLISHED, slug: "northwind-ventures", name: "Northwind Ventures", investorType: "vc", hq: "san-francisco-us", foundedYear: 2011, websiteUrl: site("northwind-ventures"), description: "Early-stage fund backing infrastructure and applied AI." },
  { ...PUBLISHED, slug: "parallel-accelerator", name: "Parallel Accelerator", investorType: "accelerator", hq: "san-francisco-us", foundedYear: 2008, websiteUrl: site("parallel-accelerator"), description: "Twice-yearly accelerator programme." },
  { ...PUBLISHED, slug: "launchpad", name: "Launchpad", investorType: "accelerator", hq: "london-gb", foundedYear: 2015, websiteUrl: site("launchpad") },
  { ...PUBLISHED, slug: "harbor-capital", name: "Harbor Capital", investorType: "vc", hq: "new-york-us", foundedYear: 2014, aumUsd: 1_200_000_000 },
  { ...PUBLISHED, slug: "fjord-kapital", name: "Fjord Kapital", investorType: "vc", hq: "berlin-de", foundedYear: 2017 },
  { ...PUBLISHED, slug: "sakura-seed", name: "Sakura Seed Fund", investorType: "vc", hq: "tokyo-jp", foundedYear: 2019 },
  { ...PUBLISHED, slug: "baobab-ventures", name: "Baobab Ventures", investorType: "vc", hq: "lagos-ng", foundedYear: 2018 },
  { ...PUBLISHED, slug: "southern-cross-capital", name: "Southern Cross Capital", investorType: "vc", hq: "sydney-au", foundedYear: 2012 },
  { ...PUBLISHED, slug: "meridian-angels", name: "Meridian Angels", investorType: "angel", hq: "singapore-sg" },
  { ...PUBLISHED, slug: "corvid-corporate-ventures", name: "Corvid Corporate Ventures", investorType: "corporate", hq: "new-york-us" },
  { ...PUBLISHED, slug: "atlas-growth", name: "Atlas Growth Partners", investorType: "pe", hq: "london-gb" },
  { ...DRAFT, slug: "quietwater-capital", name: "Quietwater Capital", investorType: "vc" },
  { ...ARCHIVED, slug: "old-mill-ventures", name: "Old Mill Ventures", investorType: "vc" },
];

// ── Batches ──────────────────────────────────────────────────────────────────────────────────

export type SeedBatch = Omit<Insert<typeof batches>, "investorId"> & {
  investor?: string;
};

export const BATCHES: SeedBatch[] = [
  { ...PUBLISHED, slug: "parallel-w25", investor: "parallel-accelerator", programName: "Parallel Accelerator", label: "W25", season: "winter", year: 2025, startsOn: "2025-01-06", demoDayOn: "2025-03-27" },
  { ...PUBLISHED, slug: "parallel-s25", investor: "parallel-accelerator", programName: "Parallel Accelerator", label: "S25", season: "summer", year: 2025, startsOn: "2025-06-02", demoDayOn: "2025-08-28" },
  { ...PUBLISHED, slug: "launchpad-sr1", investor: "launchpad", programName: "Launchpad Speedrun", label: "SR1", year: 2025, startsOn: "2025-04-07", demoDayOn: "2025-06-19" },
  { ...DRAFT, slug: "parallel-w26", investor: "parallel-accelerator", programName: "Parallel Accelerator", label: "W26", season: "winter", year: 2026 },
  { ...ARCHIVED, slug: "parallel-s24", investor: "parallel-accelerator", programName: "Parallel Accelerator", label: "S24", season: "summer", year: 2024 },
];

// ── Startups ─────────────────────────────────────────────────────────────────────────────────

export type SeedStartup = Omit<
  Insert<typeof startups>,
  | "locationId"
  | "acquiredByStartupId"
  | "latestRoundId"
  | "totalRaisedUsd"
  | "totalDebtUsd"
  | "logoAssetId"
  | "coverAssetId"
  | "ogAssetId"
> & {
  location?: string;
  /** Slug of an acquiring startup in this fixture set. */
  acquiredBy?: string;
  industries: readonly { slug: string; primary?: boolean }[];
  batches?: readonly string[];
  logo?: string;
};

export const STARTUPS: SeedStartup[] = [
  { ...PUBLISHED, slug: "kiln-analytics", name: "Kiln Analytics", tagline: "Warehouse-native product analytics.", websiteUrl: site("kiln-analytics"), stage: "series_b", workType: "onsite", headcountBand: "51-200", foundedYear: 2019, location: "berlin-de", logo: "fixtures/kiln-analytics-logo", industries: [{ slug: "devtools", primary: true }, { slug: "ai" }] },
  { ...PUBLISHED, slug: "pebble-notes", name: "Pebble Notes", tagline: "Notes that link themselves.", stage: "acquired", workType: "remote", headcountBand: "11-50", foundedYear: 2018, location: "london-gb", acquiredBy: "kiln-analytics", acquiredOn: "2025-08-01", acquiredAmountUsd: 18_000_000, industries: [{ slug: "consumer", primary: true }] },
  { ...PUBLISHED, slug: "driftwood-maps", name: "Driftwood Maps", tagline: "Offline maps for field teams.", stage: "acquired", workType: "hybrid", headcountBand: "11-50", foundedYear: 2016, location: "sydney-au", acquiredByName: "Globex Corporation", acquiredOn: "2024-11-15", industries: [{ slug: "devtools", primary: true }] },
  { ...PUBLISHED, slug: "lanternfish-ai", name: "Lanternfish AI", tagline: "Agents for deep-sea logistics.", stage: "seed", workType: "remote", headcountBand: "11-50", foundedYear: 2022, location: "san-francisco-us", batches: ["parallel-w25", "launchpad-sr1"], industries: [{ slug: "ai", primary: true }, { slug: "robotics" }] },
  { ...PUBLISHED, slug: "tidewater-labs", name: "Tidewater Labs", tagline: "Water quality sensing for cities.", stage: "dead", workType: "onsite", headcountBand: "1-10", foundedYear: 2016, isActive: false, location: "new-york-us", industries: [{ slug: "climate", primary: true }] },
  { ...PUBLISHED, slug: "quiet-harbor-health", name: "Quiet Harbor Health", tagline: "Private mental health care for teams.", stage: "series_a", workType: "remote", headcountBand: "51-200", foundedYear: 2020, location: "new-york-us", industries: [{ slug: "health", primary: true }, { slug: "ai" }] },
  { ...PUBLISHED, slug: "fjordline-energy", name: "Fjordline Energy", tagline: "Grid-scale storage from recycled batteries.", stage: "seed", workType: "onsite", headcountBand: "11-50", foundedYear: 2023, location: "zurich-ch", industries: [{ slug: "climate", primary: true }] },
  { ...PUBLISHED, slug: "baobab-pay", name: "Baobab Pay", tagline: "Payroll rails for West African SMEs.", stage: "seed", workType: "hybrid", headcountBand: "11-50", foundedYear: 2021, location: "lagos-ng", industries: [{ slug: "fintech", primary: true }] },
  { ...PUBLISHED, slug: "solstice-grid", name: "Solstice Grid", tagline: "Virtual power plants for apartment blocks.", stage: "series_a", workType: "onsite", headcountBand: "51-200", foundedYear: 2020, location: "london-gb", industries: [{ slug: "climate", primary: true }, { slug: "fintech" }] },
  { ...PUBLISHED, slug: "cafe-algorithmique", name: "Café Algorithmique", tagline: "Menus that price themselves.", stage: "pre_seed", workType: "onsite", headcountBand: "1-10", foundedYear: 2024, location: "paris-fr", industries: [{ slug: "consumer", primary: true }, { slug: "ai" }] },
  { ...PUBLISHED, slug: "wisla-robotics", name: "Wisła Robotics", tagline: "Warehouse robots that share one fleet brain.", stage: "seed", workType: "onsite", headcountBand: "11-50", foundedYear: 2022, location: "krakow-pl", industries: [{ slug: "robotics", primary: true }] },
  { ...PUBLISHED, slug: "hanami-supply", name: "Hanami Supply", tagline: "調達をもっと簡単に — procurement for small factories.", stage: "seed", workType: "onsite", headcountBand: "11-50", foundedYear: 2023, location: "tokyo-jp", industries: [{ slug: "robotics", primary: true }] },
  { ...PUBLISHED, slug: "brightpath-health", name: "Brightpath Health", tagline: "Clinical trial matching for rare diseases.", stage: "series_a", workType: "remote", headcountBand: "51-200", foundedYear: 2019, location: "bengaluru-in", industries: [{ slug: "health", primary: true }, { slug: "ai" }] },
  { ...PUBLISHED, slug: "hollow-oak-security", name: "Hollow Oak Security", tagline: "Supply-chain scanning for firmware.", stage: "seed", workType: "remote", headcountBand: "11-50", foundedYear: 2021, location: "singapore-sg", industries: [{ slug: "security", primary: true }, { slug: "devtools" }] },
  { ...PUBLISHED, slug: "paper-crane-studio", name: "Paper Crane Studio", tagline: "Tools for independent animators.", stage: "bootstrapped", workType: "remote", headcountBand: "1-10", foundedYear: 2022, location: "sao-paulo-br", industries: [{ slug: "consumer", primary: true }, { slug: "ai" }] },
  { ...PUBLISHED, slug: "tidal-ledger", name: "Tidal Ledger", tagline: "Treasury automation for marketplaces.", stage: "series_a", workType: "remote", headcountBand: "51-200", foundedYear: 2020, location: "singapore-sg", industries: [{ slug: "fintech", primary: true }, { slug: "ai" }] },
  { ...PUBLISHED, slug: "orbital-forms", name: "Orbital Forms", tagline: "Form builder for regulated industries.", stage: "series_b", workType: "remote", headcountBand: "201-500", foundedYear: 2017, location: "new-york-us", industries: [{ slug: "devtools", primary: true }, { slug: "ai" }, { slug: "security" }] },
  { ...DRAFT, slug: "stealth-draft-co", name: "Stealth Draft Co", tagline: "Not yet published.", industries: [{ slug: "quantum", primary: true }] },
  { ...ARCHIVED, slug: "sunset-legacy", name: "Sunset Legacy", tagline: "Removed from the directory.", location: "san-francisco-us", industries: [{ slug: "consumer", primary: true }] },
];

// ── Founders ─────────────────────────────────────────────────────────────────────────────────

export type SeedFounder = Omit<
  Insert<typeof founders>,
  "locationId" | "photoAssetId" | "ogAssetId"
> & { location?: string };

// No photos: fictional people, and real founders get photos only when supplied or licensed.
export const FOUNDERS: SeedFounder[] = [
  { ...PUBLISHED, slug: "mira-okafor", fullName: "Mira Okafor", headline: "Founder of Lanternfish AI", personalUrl: person("mira-okafor"), location: "san-francisco-us" },
  { ...PUBLISHED, slug: "tomasz-wrobel", fullName: "Tomasz Wróbel", headline: "CTO at Kiln Analytics", location: "berlin-de" },
  { ...PUBLISHED, slug: "jose-nunez", fullName: "José Núñez", headline: "Product engineer", location: "london-gb" },
  { ...PUBLISHED, slug: "elodie-marchand", fullName: "Élodie Marchand", headline: "Founder of Café Algorithmique", location: "paris-fr" },
  { ...PUBLISHED, slug: "zofia-kowalczyk", fullName: "Zofia Kowalczyk", headline: "Co-founder of Wisła Robotics", location: "krakow-pl" },
  { ...PUBLISHED, slug: "sato-hanako", fullName: "佐藤 花子", headline: "ハナミ・サプライ代表 — CEO at Hanami Supply", location: "tokyo-jp" },
  { ...PUBLISHED, slug: "priyanka-rao", fullName: "Priyanka Rao", headline: "CEO at Brightpath Health", location: "bengaluru-in" },
  { ...PUBLISHED, slug: "lucas-araujo", fullName: "Lucas Araújo", headline: "Founder of Paper Crane Studio", location: "sao-paulo-br" },
  { ...PUBLISHED, slug: "tan-wei-lin", fullName: "Tan Wei Lin", headline: "Co-founder of Tidal Ledger", location: "singapore-sg" },
  { ...PUBLISHED, slug: "amara-eze", fullName: "Amara Eze", headline: "CEO at Baobab Pay", location: "lagos-ng" },
  { ...PUBLISHED, slug: "noah-fischer", fullName: "Noah Fischer", headline: "Founder of Fjordline Energy", location: "zurich-ch" },
  { ...PUBLISHED, slug: "grace-liu", fullName: "Grace Liu", headline: "CEO at Quiet Harbor Health", location: "new-york-us" },
  { ...PUBLISHED, slug: "daniel-osei", fullName: "Daniel Osei", headline: "Co-founder of Solstice Grid", location: "london-gb" },
  { ...PUBLISHED, slug: "ruby-walsh", fullName: "Ruby Walsh", headline: "Founder of Driftwood Maps", location: "sydney-au" },
  { ...DRAFT, slug: "unverified-founder", fullName: "Unverified Founder" },
  { ...ARCHIVED, slug: "former-founder", fullName: "Former Founder" },
];

export type SeedStint = {
  startup: string;
  founder: string;
  role: Insert<typeof startupFounders>["role"];
  isCurrent: boolean;
  joinedYear?: number;
  leftYear?: number;
  sortOrder?: number;
};

export const STINTS: SeedStint[] = [
  // Mira Okafor: three startups, and she left Kiln Analytics and came back.
  { startup: "tidewater-labs", founder: "mira-okafor", role: "cofounder", isCurrent: false, joinedYear: 2016, leftYear: 2019 },
  { startup: "kiln-analytics", founder: "mira-okafor", role: "ceo", isCurrent: false, joinedYear: 2019, leftYear: 2021 },
  { startup: "kiln-analytics", founder: "mira-okafor", role: "ceo", isCurrent: true, joinedYear: 2024 },
  { startup: "lanternfish-ai", founder: "mira-okafor", role: "founder", isCurrent: true, joinedYear: 2022 },
  { startup: "kiln-analytics", founder: "tomasz-wrobel", role: "cto", isCurrent: true, joinedYear: 2019, sortOrder: 1 },
  { startup: "pebble-notes", founder: "jose-nunez", role: "founder", isCurrent: false, joinedYear: 2018, leftYear: 2025 },
  { startup: "cafe-algorithmique", founder: "elodie-marchand", role: "founder", isCurrent: true, joinedYear: 2024 },
  { startup: "wisla-robotics", founder: "zofia-kowalczyk", role: "cofounder", isCurrent: true, joinedYear: 2022 },
  { startup: "hanami-supply", founder: "sato-hanako", role: "ceo", isCurrent: true, joinedYear: 2023 },
  { startup: "brightpath-health", founder: "priyanka-rao", role: "ceo", isCurrent: true, joinedYear: 2019 },
  { startup: "paper-crane-studio", founder: "lucas-araujo", role: "founder", isCurrent: true, joinedYear: 2022 },
  { startup: "tidal-ledger", founder: "tan-wei-lin", role: "cofounder", isCurrent: true, joinedYear: 2020 },
  { startup: "baobab-pay", founder: "amara-eze", role: "ceo", isCurrent: true, joinedYear: 2021 },
  { startup: "fjordline-energy", founder: "noah-fischer", role: "founder", isCurrent: true, joinedYear: 2023 },
  { startup: "quiet-harbor-health", founder: "grace-liu", role: "ceo", isCurrent: true, joinedYear: 2020 },
  { startup: "orbital-forms", founder: "grace-liu", role: "advisor", isCurrent: true, joinedYear: 2021, sortOrder: 2 },
  { startup: "solstice-grid", founder: "daniel-osei", role: "cofounder", isCurrent: true, joinedYear: 2020 },
  { startup: "driftwood-maps", founder: "ruby-walsh", role: "founder", isCurrent: false, joinedYear: 2016, leftYear: 2024 },
  // hollow-oak-security intentionally has no founders.
];

// ── Funding rounds ───────────────────────────────────────────────────────────────────────────

export type SeedRound = Omit<Insert<typeof fundingRounds>, "startupId"> & {
  startup: string;
  investors?: readonly { slug: string; lead?: boolean }[];
};

function usdRound(
  startup: string,
  roundType: SeedRound["roundType"],
  announcedOn: string,
  amountUsd: number,
  investorsInRound: SeedRound["investors"] = [],
  overrides: Partial<SeedRound> = {},
): SeedRound {
  return {
    ...PUBLISHED,
    startup,
    roundType,
    announcedOn,
    amountOriginal: amountUsd.toFixed(2),
    amountUsd,
    sourceUrl: news(`${startup}-${roundType}-${announcedOn}`),
    investors: investorsInRound,
    ...overrides,
  };
}

export const ROUNDS: SeedRound[] = [
  // Northwind Ventures: five rounds, leading two.
  usdRound("kiln-analytics", "seed", "2019-05-14", 2_500_000, [{ slug: "northwind-ventures", lead: true }]),
  usdRound("kiln-analytics", "series_a", "2021-06-01", 12_000_000, [{ slug: "fjord-kapital", lead: true }]),
  usdRound("kiln-analytics", "series_b", "2024-10-03", 40_000_000, [{ slug: "harbor-capital", lead: true }, { slug: "northwind-ventures" }], { valuationUsd: 320_000_000 }),
  usdRound("pebble-notes", "seed", "2019-02-11", 1_200_000, [{ slug: "meridian-angels", lead: true }, { slug: "northwind-ventures" }]),
  usdRound("driftwood-maps", "series_a", "2020-08-20", 8_000_000, [{ slug: "southern-cross-capital", lead: true }]),
  usdRound("lanternfish-ai", "pre_seed", "2025-03-28", 750_000, [{ slug: "parallel-accelerator", lead: true }]),
  usdRound("lanternfish-ai", "seed", "2025-09-09", 4_000_000, [{ slug: "northwind-ventures", lead: true }, { slug: "launchpad" }]),
  usdRound("tidewater-labs", "seed", "2017-03-02", 1_000_000, [{ slug: "corvid-corporate-ventures", lead: true }, { slug: "northwind-ventures" }]),
  usdRound("quiet-harbor-health", "seed", "2021-01-19", 3_000_000, [{ slug: "harbor-capital", lead: true }]),
  // Undisclosed round.
  {
    ...PUBLISHED,
    startup: "quiet-harbor-health",
    roundType: "series_a",
    announcedOn: "2025-11-04",
    isUndisclosed: true,
    sourceUrl: news("quiet-harbor-health-series-a"),
    investors: [{ slug: "atlas-growth", lead: true }, { slug: "harbor-capital" }],
  },
  // EUR round converted at an (illustrative) ECB rate: 4,500,000 × 1.0842 = 4,878,900.
  {
    ...PUBLISHED,
    startup: "fjordline-energy",
    roundType: "seed",
    announcedOn: "2026-03-02",
    currency: "EUR",
    amountOriginal: "4500000.00",
    fxRate: "1.08420000",
    fxRateDate: "2026-03-02",
    fxSource: "ecb",
    amountUsd: 4_878_900,
    sourceUrl: news("fjordline-energy-seed"),
    investors: [{ slug: "fjord-kapital", lead: true }],
  },
  // NGN is not an ECB currency, so an admin entered the rate: 1,500,000,000 × 0.00061 = 915,000.
  {
    ...PUBLISHED,
    startup: "baobab-pay",
    roundType: "seed",
    announcedOn: "2026-01-20",
    currency: "NGN",
    amountOriginal: "1500000000.00",
    fxRate: "0.00061000",
    fxRateDate: "2026-01-20",
    fxSource: "manual",
    amountUsd: 915_000,
    notes: "Manual FX rate: NGN is not published by the ECB.",
    sourceUrl: news("baobab-pay-seed"),
    investors: [{ slug: "baobab-ventures", lead: true }],
  },
  // Solstice Grid: every round class, plus draft and archived rounds that must not count.
  // Expected: raised 15,000,000 (seed + series A), debt 10,000,000, latest round = series A.
  usdRound("solstice-grid", "seed", "2021-04-01", 3_000_000, [{ slug: "fjord-kapital", lead: true }]),
  usdRound("solstice-grid", "grant", "2022-02-01", 500_000),
  usdRound("solstice-grid", "debt", "2023-05-10", 10_000_000),
  usdRound("solstice-grid", "series_a", "2024-09-01", 12_000_000, [{ slug: "atlas-growth", lead: true }]),
  usdRound("solstice-grid", "secondary", "2025-03-01", 2_000_000),
  usdRound("solstice-grid", "series_b", "2026-02-01", 30_000_000, [], DRAFT),
  usdRound("solstice-grid", "bridge", "2023-01-01", 1_000_000, [], ARCHIVED),
  usdRound("cafe-algorithmique", "pre_seed", "2024-10-15", 600_000, [{ slug: "meridian-angels", lead: true }]),
  usdRound("wisla-robotics", "seed", "2023-04-12", 3_500_000, [{ slug: "fjord-kapital", lead: true }]),
  usdRound("hanami-supply", "seed", "2024-02-20", 2_000_000, [{ slug: "sakura-seed", lead: true }]),
  usdRound("brightpath-health", "series_a", "2023-07-18", 15_000_000, [{ slug: "corvid-corporate-ventures", lead: true }]),
  usdRound("hollow-oak-security", "seed", "2022-05-05", 5_000_000, [{ slug: "harbor-capital", lead: true }]),
  usdRound("tidal-ledger", "seed", "2021-03-03", 4_000_000, [{ slug: "meridian-angels", lead: true }]),
  usdRound("tidal-ledger", "series_a", "2023-12-12", 20_000_000, [{ slug: "southern-cross-capital", lead: true }]),
  usdRound("orbital-forms", "series_b", "2022-09-27", 45_000_000, [{ slug: "harbor-capital", lead: true }, { slug: "corvid-corporate-ventures" }]),
  usdRound("sunset-legacy", "seed", "2023-01-01", 1_500_000),
  // paper-crane-studio intentionally has no rounds.
];

/** Known backers whose round is unknown (investments.round_id is null, ADR-005). */
export const BACKERS_WITHOUT_ROUND: { startup: string; investor: string }[] = [
  { startup: "orbital-forms", investor: "atlas-growth" },
];

export const REDIRECTS: { entityType: "startup"; oldSlug: string; entity: string }[] = [
  { entityType: "startup", oldSlug: "kiln-data", entity: "kiln-analytics" },
];

// ── Taxonomy copy: industries and stages only, so work types exercise the generated fallback ─

export const TAXONOMY: Insert<typeof taxonomyPages>[] = [
  { kind: "industry", slug: "ai", heading: "AI startups", intro: "Companies building with machine learning.", seoTitle: "AI Startups | startupsHQ", sortOrder: 1 },
  { kind: "industry", slug: "fintech", heading: "Fintech startups", intro: "Payments, treasury and financial infrastructure.", sortOrder: 2 },
  { kind: "industry", slug: "climate", heading: "Climate startups", intro: "Energy, water and emissions.", sortOrder: 3 },
  { kind: "stage", slug: "seed", heading: "Seed-stage startups", sortOrder: 1 },
  { kind: "stage", slug: "series-a", heading: "Series A startups", sortOrder: 2 },
  { kind: "stage", slug: "series-b", heading: "Series B startups", sortOrder: 3 },
];

// ── FX rates: illustrative values; no weekend rows, so date fallback can be tested ──────────

export const FX_RATES: Insert<typeof fxRates>[] = [
  { currency: "EUR", rateDate: "2026-02-26", usdPerUnit: "1.08100000", source: "ecb" },
  { currency: "EUR", rateDate: "2026-02-27", usdPerUnit: "1.08250000", source: "ecb" },
  // 2026-02-28 and 2026-03-01 are a weekend: no rates.
  { currency: "EUR", rateDate: "2026-03-02", usdPerUnit: "1.08420000", source: "ecb" },
  { currency: "GBP", rateDate: "2026-03-02", usdPerUnit: "1.26550000", source: "ecb" },
  { currency: "JPY", rateDate: "2026-03-02", usdPerUnit: "0.00668000", source: "ecb" },
];

// ── Audit log: retention fixtures (SEC-11) ──────────────────────────────────────────────────

export type SeedAudit = {
  entity: string;
  action: "create" | "update" | "publish";
  ageDays: number;
  ip: string | null;
  diff: Record<string, unknown>;
};

export const AUDIT_ENTRIES: SeedAudit[] = [
  { entity: "kiln-analytics", action: "update", ageDays: 1, ip: "203.0.113.10", diff: { name: { from: "Kiln Data", to: "Kiln Analytics" } } },
  // Older than 90 days: the retention job must null the IP.
  { entity: "kiln-analytics", action: "publish", ageDays: 100, ip: "198.51.100.7", diff: {} },
  // Older than 12 months: the retention job must delete the row.
  { entity: "kiln-analytics", action: "create", ageDays: 400, ip: "192.0.2.44", diff: {} },
];
