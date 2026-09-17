import type { Metadata } from "next";
import Link from "next/link";
import { PageSection } from "@/components/entity/PageSection";
import { CATEGORY_TITLES, paths } from "@/lib/links";
import { PUBLIC_READ } from "@/server/auth/context";
import { getCategoryDirectory } from "@/server/cache/categories";

// The category directory (FR-107): every facet value with at least one published company.

export const metadata: Metadata = {
  title: "Categories",
  description:
    "Browse startups by industry, stage, work type, city and country.",
};

export default async function CategoriesPage() {
  const directory = await getCategoryDirectory(PUBLIC_READ);
  const groups = directory.filter((group) => group.entries.length > 0);

  return (
    <div className="mx-auto flex max-w-screen-2xl flex-col gap-12 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-2">
        <h1 className="font-medium text-3xl tracking-tight">Categories</h1>
        <p className="text-fg-muted">
          Browse companies by industry, stage, how they work and where they are.
        </p>
      </div>
      {groups.length === 0 ? (
        <p className="text-fg-muted">
          No categories yet: nothing is published.
        </p>
      ) : (
        groups.map((group) => (
          <PageSection
            key={group.kind}
            title={CATEGORY_TITLES[group.kind]}
            meta={String(group.entries.length)}
          >
            <ul className="grid grid-cols-1 gap-x-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {group.entries.map((entry) => (
                <li key={entry.slug}>
                  <Link
                    href={paths.category(group.kind, entry.slug)}
                    prefetch={false}
                    className="flex items-baseline justify-between gap-3 border-border border-b py-3 hover:text-fg-muted"
                  >
                    <span className="truncate">{entry.name}</span>
                    <span className="meta shrink-0 text-fg-subtle tabular-nums">
                      {entry.companyCount}
                      <span className="sr-only">
                        {entry.companyCount === 1 ? " company" : " companies"}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </PageSection>
        ))
      )}
    </div>
  );
}
