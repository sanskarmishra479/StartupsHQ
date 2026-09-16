import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { Money } from "@/components/data/Money";
import { StatTile } from "@/components/data/StatTile";
import { EntityHeader } from "@/components/entity/EntityHeader";
import { EntityLogo } from "@/components/entity/EntityLogo";
import { ExternalLink } from "@/components/entity/ExternalLink";
import { PagedCardGrid } from "@/components/entity/PagedCardGrid";
import { PageSection } from "@/components/entity/PageSection";
import { investorTypeLabel, stageLabel } from "@/lib/labels";
import { paths } from "@/lib/links";
import { PUBLIC_READ } from "@/server/auth/context";
import { getInvestorPage } from "@/server/cache/investors";
import { getPublishedSlugs } from "@/server/cache/slugs";

// An investor (FR-104): counts, where they invest, and the portfolio, paged through the API.

export async function generateStaticParams() {
  const slugs = await getPublishedSlugs(PUBLIC_READ, "investor");
  return (slugs.length > 0 ? slugs.slice(0, 500) : ["_"]).map((slug) => ({
    slug,
  }));
}

export async function generateMetadata({
  params,
}: PageProps<"/investors/[slug]">): Promise<Metadata> {
  const result = await getInvestorPage(PUBLIC_READ, (await params).slug);
  if (result.kind !== "found") return {};
  const investor = result.value;
  return {
    title: investor.name,
    description:
      investor.description?.slice(0, 160) ??
      `${investor.name}'s portfolio and rounds led on StartupsHQ.`,
  };
}

/** A proportional bar list; every row links to the matching slice of the portfolio. */
function Breakdown({
  rows,
  total,
}: Readonly<{
  rows: readonly { key: string; label: string; count: number; href: string }[];
  total: number;
}>) {
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <li key={row.key}>
          <Link
            href={row.href}
            prefetch={false}
            className="group flex flex-col gap-1"
          >
            <span className="flex items-baseline justify-between gap-3 text-sm">
              <span className="group-hover:underline">{row.label}</span>
              <span className="meta text-fg-subtle tabular-nums">
                {row.count}
              </span>
            </span>
            <span
              aria-hidden="true"
              className="h-1.5 overflow-hidden rounded-pill bg-surface-raised"
            >
              <span
                className="block h-full rounded-pill bg-fg-muted"
                style={{
                  width: `${Math.max(4, Math.round((row.count / Math.max(1, total)) * 100))}%`,
                }}
              />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function InvestorPage({
  params,
}: PageProps<"/investors/[slug]">) {
  const result = await getInvestorPage(PUBLIC_READ, (await params).slug);
  if (result.kind === "not-found") notFound();
  if (result.kind === "redirect")
    permanentRedirect(paths.investor(result.slug));
  const investor = result.value;
  const hq = investor.hqLocation;
  const portfolioOf = (query: string) =>
    `/companies?investor=${investor.slug}&include_acquired=true&${query}`;

  return (
    <article className="mx-auto flex max-w-screen-xl flex-col gap-12 px-4 py-8 sm:px-6 sm:py-10">
      <EntityHeader
        mark={
          <EntityLogo
            name={investor.name}
            image={investor.logo}
            size={72}
            className="size-18 text-lg"
          />
        }
        title={investor.name}
        eyebrow={[
          investorTypeLabel(investor.investorType),
          hq ? [hq.city, hq.country].filter(Boolean).join(", ") : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      >
        <ExternalLink href={investor.websiteUrl} variant="pill">
          Website
        </ExternalLink>
      </EntityHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Portfolio"
          value={String(investor.portfolioCount)}
          hint="Companies"
        />
        <StatTile label="Rounds led" value={String(investor.roundsLedCount)} />
        {investor.foundedYear !== null && (
          <StatTile label="Founded" value={String(investor.foundedYear)} />
        )}
        {investor.aumUsd !== null && (
          <StatTile
            label="Assets under management"
            value={<Money amountUsd={investor.aumUsd} />}
          />
        )}
      </div>

      {investor.description && (
        <PageSection title="About">
          <p className="max-w-prose whitespace-pre-line text-fg-muted leading-relaxed">
            {investor.description}
          </p>
        </PageSection>
      )}

      {(investor.breakdown.byStage.length > 0 ||
        investor.breakdown.byIndustry.length > 0) && (
        <div className="grid gap-12 md:grid-cols-2">
          {investor.breakdown.byStage.length > 0 && (
            <PageSection title="By stage">
              <Breakdown
                total={investor.portfolioCount}
                rows={investor.breakdown.byStage.map(({ stage, count }) => ({
                  key: stage,
                  label: stageLabel(stage) ?? stage,
                  count,
                  href: portfolioOf(`stage=${stage}`),
                }))}
              />
            </PageSection>
          )}
          {investor.breakdown.byIndustry.length > 0 && (
            <PageSection title="By industry">
              <Breakdown
                total={investor.portfolioCount}
                rows={investor.breakdown.byIndustry.map(
                  ({ slug, name, count }) => ({
                    key: slug,
                    label: name,
                    count,
                    href: portfolioOf(`industry=${slug}`),
                  }),
                )}
              />
            </PageSection>
          )}
        </div>
      )}

      <PageSection
        title="Portfolio"
        meta={`${investor.portfolioCount} companies`}
      >
        {investor.portfolio.length > 0 ? (
          <PagedCardGrid
            label="Portfolio"
            initialPage={{
              data: [...investor.portfolio],
              pagination: investor.pagination,
            }}
            endpoint={`/api/v1/investors/${investor.slug}/portfolio`}
          />
        ) : (
          <p className="text-fg-muted">
            No portfolio companies are recorded yet.
          </p>
        )}
      </PageSection>
    </article>
  );
}
