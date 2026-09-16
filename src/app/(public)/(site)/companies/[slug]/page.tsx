import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { type MetaItem, MetaRow } from "@/components/data/MetaRow";
import { Money } from "@/components/data/Money";
import { StatTile } from "@/components/data/StatTile";
import { EntityHeader } from "@/components/entity/EntityHeader";
import { EntityLogo } from "@/components/entity/EntityLogo";
import { ExternalLink } from "@/components/entity/ExternalLink";
import { PageSection } from "@/components/entity/PageSection";
import { RoundTimeline } from "@/components/entity/RoundTimeline";
import { CardGrid } from "@/components/explore/CardGrid";
import { ResponsiveImage } from "@/components/media/ResponsiveImage";
import { formatHeadcount, formatTenure } from "@/lib/format";
import { founderRoleLabel, stageLabel, workTypeLabel } from "@/lib/labels";
import { paths } from "@/lib/links";
import { PUBLIC_READ } from "@/server/auth/context";
import { getPublishedSlugs } from "@/server/cache/slugs";
import { getSimilarStartups, getStartupPage } from "@/server/cache/startups";

// A company (FR-102). The record is looked up before anything renders, so unknown, draft and
// archived slugs answer a real 404 and an old slug a permanent redirect, not a streamed soft one.

/** Known companies prerender at build; any other slug renders on its first visit. */
export async function generateStaticParams() {
  const slugs = await getPublishedSlugs(PUBLIC_READ, "startup");
  return (slugs.length > 0 ? slugs.slice(0, 500) : ["_"]).map((slug) => ({
    slug,
  }));
}

async function load(slug: string) {
  const result = await getStartupPage(PUBLIC_READ, slug);
  if (result.kind === "not-found") notFound();
  if (result.kind === "redirect") permanentRedirect(paths.company(result.slug));
  return result.value;
}

export async function generateMetadata({
  params,
}: PageProps<"/companies/[slug]">): Promise<Metadata> {
  const result = await getStartupPage(PUBLIC_READ, (await params).slug);
  if (result.kind !== "found") return {};
  const company = result.value;
  return {
    title: company.name,
    description: company.tagline ?? `${company.name} on StartupsHQ.`,
  };
}

export default async function CompanyPage({
  params,
}: PageProps<"/companies/[slug]">) {
  const { slug } = await params;
  const company = await load(slug);
  const similar = await getSimilarStartups(PUBLIC_READ, company.slug);

  const location = company.location;
  const inlineLink =
    "underline decoration-border-strong underline-offset-4 hover:decoration-fg";
  const meta: (MetaItem | null)[] = [
    company.stage
      ? {
          label: "Stage",
          value: stageLabel(company.stage),
          href: paths.stage(company.stage),
        }
      : null,
    company.industries.length > 0
      ? {
          label: company.industries.length > 1 ? "Industries" : "Industry",
          value: company.industries.map((industry, index) => (
            <span key={industry.slug}>
              {index > 0 && ", "}
              <Link
                href={paths.industry(industry.slug)}
                prefetch={false}
                className={inlineLink}
              >
                {industry.name}
              </Link>
            </span>
          )),
        }
      : null,
    location
      ? {
          label: "Location",
          value: [location.city, location.country].filter(Boolean).join(", "),
          href: location.city ? paths.city(location.slug) : undefined,
        }
      : null,
    company.workType
      ? {
          label: "Work",
          value: workTypeLabel(company.workType),
          href: paths.workType(company.workType),
        }
      : null,
    company.foundedYear
      ? { label: "Founded", value: String(company.foundedYear) }
      : null,
    { label: "Team", value: formatHeadcount(company.headcountBand) },
  ];

  return (
    <article className="mx-auto flex max-w-screen-xl flex-col gap-12 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-8">
        {company.cover && (
          <ResponsiveImage
            image={company.cover}
            alt=""
            sizes="(min-width: 1280px) 1232px, 100vw"
            priority
            className="aspect-(--aspect-cover) max-h-[28rem] w-full rounded-md border border-border"
          />
        )}
        <EntityHeader
          mark={
            <EntityLogo
              name={company.name}
              image={company.logo}
              size={72}
              className="size-16 text-lg sm:size-18"
            />
          }
          title={company.name}
          subtitle={company.tagline}
          eyebrow={
            company.acquiredBy ? (
              <>
                Acquired by{" "}
                {company.acquiredBy.slug ? (
                  <Link
                    href={paths.company(company.acquiredBy.slug)}
                    className="text-fg underline underline-offset-4"
                  >
                    {company.acquiredBy.name}
                  </Link>
                ) : (
                  company.acquiredBy.name
                )}
              </>
            ) : !company.isActive ? (
              "No longer operating"
            ) : undefined
          }
        >
          <ExternalLink href={company.websiteUrl} variant="pill">
            Website
          </ExternalLink>
          <ExternalLink href={company.careersUrl} variant="pill">
            Careers
          </ExternalLink>
        </EntityHeader>
        <MetaRow
          items={meta.filter((item): item is MetaItem => item !== null)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Total raised"
          value={
            company.totalRaisedUsd === null ? (
              "—"
            ) : (
              <Money amountUsd={company.totalRaisedUsd} />
            )
          }
          hint="Equity and convertible rounds"
        />
        {company.totalDebtUsd !== null && company.totalDebtUsd > 0 && (
          <StatTile
            label="Debt"
            value={<Money amountUsd={company.totalDebtUsd} />}
            hint="Not counted in total raised"
          />
        )}
        <StatTile
          label="Rounds"
          value={String(company.rounds.length)}
          hint={
            company.latestRound
              ? `Latest ${company.latestRound.announcedOn.slice(0, 4)}`
              : undefined
          }
        />
        {company.acquiredAmountUsd !== null && (
          <StatTile
            label="Acquired for"
            value={<Money amountUsd={company.acquiredAmountUsd} />}
          />
        )}
      </div>

      {company.description && (
        <PageSection title="About">
          <p className="max-w-prose whitespace-pre-line text-fg-muted leading-relaxed">
            {company.description}
          </p>
          <div className="flex flex-wrap gap-4 text-sm">
            <ExternalLink href={company.links.linkedin}>LinkedIn</ExternalLink>
            <ExternalLink href={company.links.x}>X</ExternalLink>
            <ExternalLink href={company.links.github}>GitHub</ExternalLink>
          </div>
        </PageSection>
      )}

      {company.founders.length > 0 && (
        <PageSection
          title="Founders and team"
          meta={String(company.founders.length)}
        >
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {company.founders.map((founder) => (
              <li key={`${founder.slug}-${founder.role}-${founder.joinedYear}`}>
                <Link
                  href={paths.founder(founder.slug)}
                  className="flex items-center gap-3 rounded-md border border-border p-3 transition-colors duration-(--duration-fast) hover:bg-surface-hover"
                >
                  <EntityLogo
                    name={founder.fullName}
                    image={founder.photo}
                    size={44}
                    shape="circle"
                    className="size-11 text-sm"
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">
                      {founder.fullName}
                    </span>
                    <span className="truncate text-fg-muted text-sm">
                      {[
                        founderRoleLabel(founder.role),
                        formatTenure(
                          founder.joinedYear,
                          founder.leftYear,
                          founder.isCurrent,
                        ),
                        founder.isCurrent ? null : "past",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </PageSection>
      )}

      {company.investors.length > 0 && (
        <PageSection title="Backed by" meta={String(company.investors.length)}>
          <ul className="flex flex-wrap gap-2">
            {company.investors.map((investor) => (
              <li key={investor.slug}>
                <Link
                  href={paths.investor(investor.slug)}
                  className="flex items-center gap-2 rounded-pill border border-border py-1 pr-3.5 pl-1 text-sm transition-colors duration-(--duration-fast) hover:bg-surface-hover"
                >
                  <EntityLogo
                    name={investor.name}
                    image={investor.logo}
                    size={28}
                    shape="circle"
                    className="size-7 text-[0.625rem]"
                  />
                  {investor.name}
                  {investor.isLead && (
                    <span className="meta text-fg-subtle">Lead</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </PageSection>
      )}

      {company.batches.length > 0 && (
        <PageSection title="Accelerator batches">
          <ul className="flex flex-wrap gap-2">
            {company.batches.map((batch) => (
              <li key={batch.slug}>
                <Link
                  href={paths.batch(batch.slug)}
                  className="inline-flex h-9 items-center gap-2 rounded-pill border border-border-strong px-4 text-sm hover:bg-surface-hover"
                >
                  {batch.programName}
                  <span className="meta text-fg-subtle">{batch.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </PageSection>
      )}

      <PageSection
        title="Funding"
        meta={
          company.rounds.length > 0
            ? `${company.rounds.length} rounds`
            : undefined
        }
      >
        {company.rounds.length > 0 ? (
          <RoundTimeline rounds={company.rounds} />
        ) : (
          <p className="text-fg-muted">No funding rounds are recorded.</p>
        )}
      </PageSection>

      {Array.isArray(similar) && similar.length > 0 && (
        <PageSection
          title="Similar companies"
          action={{ href: "/companies", label: "All companies" }}
        >
          <CardGrid
            cards={similar}
            label="Similar companies"
            headingLevel={3}
          />
        </PageSection>
      )}
    </article>
  );
}
