import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { EntityHeader } from "@/components/entity/EntityHeader";
import { EntityLogo } from "@/components/entity/EntityLogo";
import { ExternalLink } from "@/components/entity/ExternalLink";
import { PageSection } from "@/components/entity/PageSection";
import { formatTenure } from "@/lib/format";
import { founderRoleLabel, stageLabel } from "@/lib/labels";
import { paths } from "@/lib/links";
import { PUBLIC_READ } from "@/server/auth/context";
import { getFounderPage } from "@/server/cache/founders";
import { getPublishedSlugs } from "@/server/cache/slugs";

// A founder (FR-103): every company, with role and tenure, newest first. Founders have a photo
// only when it is supplied or licensed; otherwise initials (ADR-019).

export async function generateStaticParams() {
  const slugs = await getPublishedSlugs(PUBLIC_READ, "founder");
  return (slugs.length > 0 ? slugs.slice(0, 500) : ["_"]).map((slug) => ({
    slug,
  }));
}

export async function generateMetadata({
  params,
}: PageProps<"/founders/[slug]">): Promise<Metadata> {
  const result = await getFounderPage(PUBLIC_READ, (await params).slug);
  if (result.kind !== "found") return {};
  return {
    title: result.value.fullName,
    description:
      result.value.headline ?? `${result.value.fullName} on StartupsHQ.`,
  };
}

export default async function FounderPage({
  params,
}: PageProps<"/founders/[slug]">) {
  const result = await getFounderPage(PUBLIC_READ, (await params).slug);
  if (result.kind === "not-found") notFound();
  if (result.kind === "redirect") permanentRedirect(paths.founder(result.slug));
  const founder = result.value;
  const location = founder.location;

  return (
    <article className="mx-auto flex max-w-screen-lg flex-col gap-12 px-4 py-8 sm:px-6 sm:py-10">
      <EntityHeader
        mark={
          <EntityLogo
            name={founder.fullName}
            image={founder.photo}
            size={80}
            shape="circle"
            decorative={false}
            className="size-20 text-xl"
          />
        }
        title={founder.fullName}
        subtitle={founder.headline}
        eyebrow={
          location ? (
            location.city ? (
              <Link href={paths.city(location.slug)} className="hover:text-fg">
                {[location.city, location.country].join(", ")}
              </Link>
            ) : (
              location.country
            )
          ) : undefined
        }
      >
        <ExternalLink href={founder.links.linkedin} variant="pill">
          LinkedIn
        </ExternalLink>
        <ExternalLink href={founder.links.x} variant="pill">
          X
        </ExternalLink>
        <ExternalLink href={founder.links.github} variant="pill">
          GitHub
        </ExternalLink>
        <ExternalLink href={founder.links.personal} variant="pill">
          Website
        </ExternalLink>
      </EntityHeader>

      {founder.bio && (
        <PageSection title="About">
          <p className="max-w-prose whitespace-pre-line text-fg-muted leading-relaxed">
            {founder.bio}
          </p>
        </PageSection>
      )}

      <PageSection
        title="Companies"
        meta={`${founder.startupCount} ${founder.startupCount === 1 ? "company" : "companies"}`}
      >
        {founder.startups.length === 0 ? (
          <p className="text-fg-muted">No companies are recorded yet.</p>
        ) : (
          <ol className="flex flex-col">
            {founder.startups.map(
              ({ startup, role, isCurrent, joinedYear, leftYear }) => (
                <li
                  key={`${startup.slug}-${role}-${joinedYear}-${leftYear}`}
                  className="border-border border-b last:border-b-0"
                >
                  <Link
                    href={paths.company(startup.slug)}
                    className="flex items-center gap-4 py-4 transition-colors duration-(--duration-fast) hover:bg-surface-hover sm:px-2"
                  >
                    <EntityLogo
                      name={startup.name}
                      image={startup.logo}
                      size={48}
                      className="size-12 text-sm"
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate font-medium">
                        {startup.name}
                      </span>
                      <span className="truncate text-fg-muted text-sm">
                        {[
                          founderRoleLabel(role),
                          formatTenure(joinedYear, leftYear, isCurrent),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      {startup.tagline && (
                        <span className="truncate text-fg-subtle text-sm">
                          {startup.tagline}
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="meta rounded-xs border border-border-strong px-1.5 text-fg-muted">
                        {isCurrent ? "Current" : "Past"}
                      </span>
                      {startup.stage && (
                        <span className="meta text-fg-subtle">
                          {stageLabel(startup.stage)}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              ),
            )}
          </ol>
        )}
      </PageSection>
    </article>
  );
}
