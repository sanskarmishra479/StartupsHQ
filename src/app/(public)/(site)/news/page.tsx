import type { Metadata } from "next";
import { NewsFeed } from "@/components/entity/NewsFeed";
import { PUBLIC_READ } from "@/server/auth/context";
import { getNewsFirstPage } from "@/server/cache/rounds";

// The news feed (FR-106): funding rounds newest first, each citing its source. The first page is
// prerendered; later pages come from GET /api/v1/rounds.

export const metadata: Metadata = {
  title: "News",
  description: "The latest startup funding rounds, each with its source.",
};

export default async function NewsPage() {
  const firstPage = await getNewsFirstPage(PUBLIC_READ);
  return (
    <div className="mx-auto flex max-w-screen-lg flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-2">
        <h1 className="font-medium text-3xl tracking-tight">News</h1>
        <p className="text-fg-muted">
          Funding rounds as they are announced, newest first, with sources.
        </p>
      </div>
      <NewsFeed initialPage={firstPage} endpoint="/api/v1/rounds" />
    </div>
  );
}
