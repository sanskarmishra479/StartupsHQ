"use client";

import Link from "next/link";
import { formatDate } from "@/lib/format";
import { roundTypeLabel } from "@/lib/labels";
import { paths } from "@/lib/links";
import type { NewsItem, Page } from "@/types/public";
import { EmptyState } from "../data/EmptyState";
import { LoadMore } from "../data/LoadMore";
import { Money } from "../data/Money";
import { PillButton } from "../ui/PillButton";
import { EntityLogo } from "./EntityLogo";
import { ExternalLink } from "./ExternalLink";
import { usePagedList } from "./usePagedList";

const idOf = (item: NewsItem) => item.round.id;

/** Consecutive items sharing an announcement date, in feed order. */
function byDate(items: readonly NewsItem[]) {
  const groups: { date: string; items: NewsItem[] }[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last?.date === item.round.announcedOn) last.items.push(item);
    else groups.push({ date: item.round.announcedOn, items: [item] });
  }
  return groups;
}

/** Funding rounds newest first, grouped by date, each citing its source (FR-106). */
export function NewsFeed({
  initialPage,
  endpoint,
}: Readonly<{ initialPage: Page<NewsItem>; endpoint: string }>) {
  const { items, hasMore, depthLimited, status, loadMore } = usePagedList(
    initialPage,
    endpoint,
    idOf,
  );

  if (items.length === 0) {
    return (
      <EmptyState title="No rounds yet">
        Funding rounds appear here as they are announced.
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {byDate(items).map((group) => (
        <section
          key={group.date}
          aria-labelledby={`day-${group.date}`}
          className="flex flex-col"
        >
          <h2
            id={`day-${group.date}`}
            className="meta sticky top-14 z-10 border-border border-b bg-bg py-2 text-fg-subtle"
          >
            <time dateTime={group.date}>{formatDate(group.date)}</time>
          </h2>
          <ul className="flex flex-col">
            {group.items.map(({ round, startup }) => (
              <li
                key={round.id}
                className="flex flex-col gap-3 border-border border-b py-4 last:border-b-0 sm:flex-row sm:items-center sm:gap-5"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <EntityLogo
                    name={startup.name}
                    image={startup.logo}
                    size={40}
                    className="size-10 text-xs"
                  />
                  <div className="flex min-w-0 flex-col">
                    <h3 className="truncate font-medium">
                      <Link
                        href={paths.company(startup.slug)}
                        prefetch={false}
                        className="hover:underline"
                      >
                        {startup.name}
                      </Link>
                    </h3>
                    <p className="text-fg-muted text-sm">
                      {roundTypeLabel(round.roundType) ?? round.roundType}
                      {round.investors.length > 0 && " · "}
                      {round.investors.slice(0, 3).map((investor, index) => (
                        <span key={investor.slug}>
                          {index > 0 && ", "}
                          <Link
                            href={paths.investor(investor.slug)}
                            prefetch={false}
                            className="underline decoration-border-strong underline-offset-4 hover:decoration-fg"
                          >
                            {investor.name}
                          </Link>
                          {investor.isLead && " (lead)"}
                        </span>
                      ))}
                      {round.investors.length > 3 &&
                        ` and ${round.investors.length - 3} more`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-4 sm:flex-col sm:items-end sm:gap-1">
                  <Money
                    className="font-medium"
                    amountUsd={round.amountUsd}
                    isUndisclosed={round.isUndisclosed}
                    currency={round.currency}
                    amountOriginal={round.amountOriginal}
                  />
                  <span className="text-sm">
                    <ExternalLink href={round.sourceUrl}>Source</ExternalLink>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {status === "error" ? (
        <div className="flex flex-col items-center gap-3 py-4">
          <p className="text-fg-muted text-sm">
            More rounds could not be loaded.
          </p>
          <PillButton variant="outline" onClick={() => void loadMore()}>
            Try again
          </PillButton>
        </div>
      ) : (
        (hasMore || depthLimited) && (
          <LoadMore
            shown={items.length}
            pending={status === "loading"}
            hasMore={hasMore}
            depthLimited={depthLimited}
            onLoadMore={() => void loadMore()}
          />
        )
      )}
    </div>
  );
}
