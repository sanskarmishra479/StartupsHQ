import type { Metadata } from "next";
import { Suspense } from "react";
import { CardGridSkeleton } from "@/components/explore/CardGrid";
import { SearchView } from "@/components/search/SearchView";

// Search (FR-109). The page is a static shell; results come from GET /api/v1/search, which is
// never cached per query (ADR-013). Result pages are not indexed: the entity pages are.

export const metadata: Metadata = {
  title: "Search",
  description:
    "Search startups, founders, investors and accelerator batches by name.",
  robots: { index: false, follow: true },
};

export default function SearchPage() {
  return (
    <div className="mx-auto flex max-w-screen-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="font-medium text-3xl tracking-tight">Search</h1>
      <Suspense
        fallback={
          <div className="flex flex-col gap-6">
            <div className="h-12 rounded-pill border border-border-strong bg-surface" />
            <CardGridSkeleton count={6} />
          </div>
        }
      >
        <SearchView />
      </Suspense>
    </div>
  );
}
