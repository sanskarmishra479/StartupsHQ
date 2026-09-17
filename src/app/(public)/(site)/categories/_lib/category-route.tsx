import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PagedCardGrid } from "@/components/entity/PagedCardGrid";
import { PageSection } from "@/components/entity/PageSection";
import { CATEGORY_TITLES, categoryCompaniesQuery } from "@/lib/links";
import { PUBLIC_READ } from "@/server/auth/context";
import {
  getCategoryDirectory,
  getCategoryPage,
} from "@/server/cache/categories";
import type { CategoryKind } from "@/types/public";

// The one component behind all five category route shapes (FR-108). Each route file names its
// kind and delegates here. The page is looked up before anything renders, so a value that does not
// exist, or has no published company, is a real 404.

type Params = Promise<{ slug: string }>;

async function entriesOf(kind: CategoryKind) {
  const directory = await getCategoryDirectory(PUBLIC_READ);
  return directory.find((group) => group.kind === kind)?.entries ?? [];
}

export function categoryStaticParams(kind: CategoryKind) {
  return async () => {
    const entries = await entriesOf(kind);
    return (entries.length > 0 ? entries.map(({ slug }) => slug) : ["_"]).map(
      (slug) => ({ slug }),
    );
  };
}

export function categoryMetadata(kind: CategoryKind) {
  return async ({ params }: { params: Params }): Promise<Metadata> => {
    const page = await getCategoryPage(PUBLIC_READ, kind, (await params).slug);
    if ("kind" in page && page.kind === kind) {
      return {
        // The title template adds the site name; seoTitle already carries it.
        title: { absolute: page.seoTitle },
        description: page.seoDescription,
        // Thin facets stay out of search results (FR-108).
        robots: page.isIndexable ? undefined : { index: false, follow: true },
      };
    }
    return {};
  };
}

/** Editor copy is plain text: paragraphs split on blank lines, never parsed as HTML. */
function Intro({ text }: Readonly<{ text: string }>) {
  return (
    <div className="flex max-w-prose flex-col gap-3 text-fg-muted leading-relaxed">
      {text
        .split(/\n\s*\n/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph) => (
          <p key={paragraph.slice(0, 40)} className="whitespace-pre-line">
            {paragraph}
          </p>
        ))}
    </div>
  );
}

export function categoryPage(kind: CategoryKind) {
  return async function CategoryRoute({ params }: { params: Params }) {
    const { slug } = await params;
    const page = await getCategoryPage(PUBLIC_READ, kind, slug);
    if (!("heading" in page)) notFound();

    const countryCode =
      kind === "countries"
        ? (await entriesOf("countries")).find((entry) => entry.slug === slug)
            ?.countryCode
        : undefined;
    const query = categoryCompaniesQuery(kind, slug, countryCode);
    const plural = page.companyCount === 1 ? "company" : "companies";

    return (
      <article className="mx-auto flex max-w-screen-2xl flex-col gap-10 px-4 py-8 sm:px-6 sm:py-10">
        <header className="flex flex-col gap-3">
          <p className="meta text-fg-subtle">
            <Link href="/categories" className="hover:text-fg">
              Categories
            </Link>{" "}
            / {CATEGORY_TITLES[kind]}
          </p>
          <h1 className="font-medium text-3xl tracking-tight sm:text-display">
            {page.heading}
          </h1>
          {page.intro && <Intro text={page.intro} />}
        </header>

        <PageSection title="Companies" meta={`${page.companyCount} ${plural}`}>
          <PagedCardGrid
            label={`${page.heading}: companies`}
            initialPage={{
              data: [...page.companies],
              pagination: page.pagination,
            }}
            endpoint={query ? `/api/v1/startups?${query}` : "/api/v1/startups"}
            disableMore={query === null}
          />
        </PageSection>
      </article>
    );
  };
}
