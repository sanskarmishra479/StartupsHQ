import type { Image, StartupCard } from "@/types/public";

// Fictional sample data for the components gallery. Covers and logos are generated SVG data URLs,
// so the gallery needs no Blob store, network or database.

const svgUrl = (svg: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

function sampleImage(svg: string, width: number, height: number): Image {
  const url = svgUrl(svg);
  return { url, blurDataUrl: null, width, height, variants: [{ width, url }] };
}

function cover(hue: number, variant: number): Image {
  const a = `hsl(${hue} 70% 55%)`;
  const b = `hsl(${(hue + 40) % 360} 60% 22%)`;
  const shapes = [
    `<circle cx="820" cy="300" r="220" fill="${a}"/>`,
    `<rect x="160" y="140" width="520" height="340" rx="170" fill="${a}"/>`,
    `<path d="M0 630 L600 80 L1200 630Z" fill="${a}"/>`,
    `<rect x="380" y="120" width="440" height="390" rx="24" fill="${a}" transform="rotate(12 600 315)"/>`,
  ];
  return sampleImage(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="${b}"/>${shapes[variant % shapes.length]}</svg>`,
    1200,
    630,
  );
}

function logo(hue: number, letter: string): Image {
  return sampleImage(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="hsl(${hue} 65% 45%)"/><text x="32" y="43" font-family="system-ui,sans-serif" font-size="30" font-weight="700" text-anchor="middle" fill="#fff">${letter}</text></svg>`,
    64,
    64,
  );
}

type Sample = Readonly<{
  name: string;
  hue: number;
  stage: StartupCard["stage"];
  industry: string;
  workType: StartupCard["workType"];
  round?: Readonly<{ usd: number | null; on: string }>;
  city?: string;
  withCover?: boolean;
  withLogo?: boolean;
}>;

const SAMPLES: readonly Sample[] = [
  {
    name: "Northwind Labs",
    hue: 210,
    stage: "seed",
    industry: "Developer tools",
    workType: "remote",
    round: { usd: 4_500_000, on: "2026-05-12" },
  },
  {
    name: "Quillfeather",
    hue: 28,
    stage: "series_a",
    industry: "Fintech",
    workType: "hybrid",
    round: { usd: 18_000_000, on: "2026-02-03" },
  },
  {
    name: "Orbital Kitchen",
    hue: 140,
    stage: "pre_seed",
    industry: "Food",
    workType: "onsite",
    city: "Lisbon",
  },
  {
    name: "Helix & Vine",
    hue: 300,
    stage: "series_b",
    industry: "Biotech",
    workType: "onsite",
    round: { usd: null, on: "2025-11-20" },
  },
  {
    name: "Parcelwise",
    hue: 48,
    stage: "growth",
    industry: "Logistics",
    workType: "hybrid",
    round: { usd: 120_000_000, on: "2026-08-01" },
    withCover: false,
  },
  {
    name: "Tidewater Energy",
    hue: 180,
    stage: "series_c",
    industry: "Climate",
    workType: "onsite",
    round: { usd: 64_000_000, on: "2026-01-15" },
  },
  {
    name: "Lumen Health",
    hue: 0,
    stage: "seed",
    industry: "Healthcare",
    workType: "remote",
    round: { usd: 2_200_000, on: "2026-06-30" },
    withCover: false,
    withLogo: false,
  },
  {
    name: "Glasshouse AI",
    hue: 260,
    stage: "series_a",
    industry: "Artificial intelligence",
    workType: "hybrid",
    round: { usd: 25_000_000, on: "2026-07-09" },
  },
  {
    name: "Brightpath Learning",
    hue: 90,
    stage: "bootstrapped",
    industry: "Education",
    workType: "remote",
    city: "Nairobi",
  },
  {
    name: "Cobalt Security",
    hue: 225,
    stage: "series_b",
    industry: "Security",
    workType: "onsite",
    round: { usd: 41_000_000, on: "2025-09-22" },
  },
  {
    name: "Fernway",
    hue: 120,
    stage: "acquired",
    industry: "Travel",
    workType: "remote",
    withLogo: false,
  },
  {
    name: "Mosaic Robotics",
    hue: 15,
    stage: "series_a",
    industry: "Robotics",
    workType: "onsite",
    round: { usd: 15_500_000, on: "2026-04-18" },
  },
];

export const SAMPLE_CARDS: readonly StartupCard[] = SAMPLES.map(
  (sample, index) => ({
    slug: sample.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name: sample.name,
    tagline: null,
    logo:
      sample.withLogo === false
        ? null
        : logo(sample.hue, sample.name.charAt(0)),
    cover: sample.withCover === false ? null : cover(sample.hue, index),
    stage: sample.stage,
    workType: sample.workType,
    primaryIndustry: {
      slug: sample.industry.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      name: sample.industry,
      iconUrl: null,
    },
    location: sample.city
      ? { slug: "x", city: sample.city, country: "—", countryCode: "XX" }
      : null,
    latestRound: sample.round
      ? {
          roundType: "seed",
          amountUsd: sample.round.usd,
          isUndisclosed: sample.round.usd === null,
          announcedOn: sample.round.on,
        }
      : null,
    totalRaisedUsd: sample.round?.usd ?? null,
    acquiredBy:
      sample.stage === "acquired" ? { name: "Atlas Group", slug: null } : null,
  }),
);
