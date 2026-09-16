import type { Metadata } from "next";
import { Suspense } from "react";
import { ExploreFallback } from "@/components/explore/ExploreFallback";
import { ExploreGrid } from "@/components/explore/ExploreGrid";
import { EXPLORE_PENDING_SCRIPT } from "@/lib/explore-query";
import { PUBLIC_READ } from "@/server/auth/context";
import { getCategoryDirectory } from "@/server/cache/categories";
import { getStartupsFirstPage } from "@/server/cache/startups";
import { getDirectoryCounts } from "@/server/cache/stats";

// The explore grid, "Show all" (FR-101, moved from / by ADR-023). The page itself is static: it
// reads no search params, so it prerenders with the cached unfiltered first page. The client grid
// takes the URL from there.

export const metadata: Metadata = {
  title: "Companies",
  description:
    "Every startup in the directory — filter by stage, industry, work type and location.",
};

const number = new Intl.NumberFormat("en-US");

export default async function CompaniesPage() {
  const [firstPage, directory, counts] = await Promise.all([
    getStartupsFirstPage(PUBLIC_READ, "recent"),
    getCategoryDirectory(PUBLIC_READ),
    getDirectoryCounts(PUBLIC_READ),
  ]);

  return (
    <div className="mx-auto flex max-w-screen-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-medium text-3xl tracking-tight">Companies</h1>
        <p className="meta text-fg-subtle">
          {number.format(counts.startups)} in the directory
        </p>
      </div>
      <script
        // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant from src/lib/explore-query.ts, no input.
        dangerouslySetInnerHTML={{ __html: EXPLORE_PENDING_SCRIPT }}
      />
      <Suspense fallback={<ExploreFallback page={firstPage} />}>
        <ExploreGrid initialPage={firstPage} directory={directory} />
      </Suspense>
    </div>
  );
}
