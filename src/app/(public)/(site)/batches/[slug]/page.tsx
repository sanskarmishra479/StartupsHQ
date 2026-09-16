import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { type MetaItem, MetaRow } from "@/components/data/MetaRow";
import { Money } from "@/components/data/Money";
import { StatTile } from "@/components/data/StatTile";
import { EntityHeader } from "@/components/entity/EntityHeader";
import { EntityLogo } from "@/components/entity/EntityLogo";
import { PagedCardGrid } from "@/components/entity/PagedCardGrid";
import { PageSection } from "@/components/entity/PageSection";
import { formatDate } from "@/lib/format";
import { paths } from "@/lib/links";
import { PUBLIC_READ } from "@/server/auth/context";
import { getBatchPage } from "@/server/cache/batches";
import { getPublishedSlugs } from "@/server/cache/slugs";

// An accelerator batch (FR-105): the cohort and its numbers. Later cohort pages come from
// GET /startups?batch=, acquired companies included as on the first page (API §6.8).

export async function generateStaticParams() {
  const slugs = await getPublishedSlugs(PUBLIC_READ, "batch");
  return (slugs.length > 0 ? slugs.slice(0, 500) : ["_"]).map((slug) => ({
    slug,
  }));
}

export async function generateMetadata({
  params,
}: PageProps<"/batches/[slug]">): Promise<Metadata> {
  const result = await getBatchPage(PUBLIC_READ, (await params).slug);
  if (result.kind !== "found") return {};
  const batch = result.value;
  return {
    title: `${batch.programName} ${batch.label}`,
    description: `The ${batch.stats.companyCount} companies of ${batch.programName} ${batch.label}.`,
  };
}

export default async function BatchPage({
  params,
}: PageProps<"/batches/[slug]">) {
  const result = await getBatchPage(PUBLIC_READ, (await params).slug);
  if (result.kind === "not-found") notFound();
  if (result.kind === "redirect") permanentRedirect(paths.batch(result.slug));
  const batch = result.value;

  const meta: (MetaItem | null)[] = [
    batch.investor
      ? {
          label: "Run by",
          value: batch.investor.name,
          href: paths.investor(batch.investor.slug),
        }
      : null,
    { label: "Year", value: String(batch.year) },
    batch.startsOn
      ? { label: "Starts", value: formatDate(batch.startsOn) }
      : null,
    batch.demoDayOn
      ? { label: "Demo day", value: formatDate(batch.demoDayOn) }
      : null,
  ];

  return (
    <article className="mx-auto flex max-w-screen-xl flex-col gap-12 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-6">
        <EntityHeader
          mark={
            <EntityLogo
              name={batch.programName}
              image={batch.logo ?? batch.investor?.logo ?? null}
              size={72}
              className="size-18 text-lg"
            />
          }
          eyebrow="Accelerator batch"
          title={
            <>
              {batch.programName}{" "}
              <span className="text-fg-muted">{batch.label}</span>
            </>
          }
        />
        <MetaRow
          items={meta.filter((item): item is MetaItem => item !== null)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatTile label="Companies" value={String(batch.stats.companyCount)} />
        <StatTile
          label="Total raised"
          value={<Money amountUsd={batch.stats.totalRaisedUsd} />}
          hint="Across the cohort"
        />
        {batch.stats.topIndustries.length > 0 && (
          <div className="col-span-2 flex flex-col gap-2 rounded-md border border-border bg-surface p-4 lg:col-span-1">
            <span className="meta text-fg-subtle">Top industries</span>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {batch.stats.topIndustries.map((industry) => (
                <li key={industry.slug}>
                  <Link
                    href={paths.industry(industry.slug)}
                    prefetch={false}
                    className="hover:underline"
                  >
                    {industry.name}
                  </Link>{" "}
                  <span className="meta text-fg-subtle">{industry.count}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {batch.description && (
        <PageSection title="About">
          <p className="max-w-prose whitespace-pre-line text-fg-muted leading-relaxed">
            {batch.description}
          </p>
        </PageSection>
      )}

      <PageSection
        title="Cohort"
        meta={`${batch.stats.companyCount} companies`}
      >
        {batch.companies.length > 0 ? (
          <PagedCardGrid
            label="Cohort"
            initialPage={{
              data: [...batch.companies],
              pagination: batch.pagination,
            }}
            endpoint={`/api/v1/startups?batch=${batch.slug}&include_acquired=true`}
          />
        ) : (
          <p className="text-fg-muted">
            No companies are recorded for this batch yet.
          </p>
        )}
      </PageSection>
    </article>
  );
}
