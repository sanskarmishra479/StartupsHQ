import Link from "next/link";
import { formatDate } from "@/lib/format";
import { roundTypeLabel } from "@/lib/labels";
import { paths } from "@/lib/links";
import type { Round } from "@/types/public";
import { Money } from "../data/Money";
import { ExternalLink } from "./ExternalLink";

const DEBT_LIKE = new Set(["debt", "non_dilutive", "secondary"]);

/** A company's rounds, newest first, each with its investors and its cited source (FR-102). */
export function RoundTimeline({
  rounds,
}: Readonly<{ rounds: readonly Round[] }>) {
  return (
    <ol className="flex flex-col">
      {rounds.map((round) => (
        <li
          key={round.id}
          id={`round-${round.id}`}
          className="grid gap-x-6 gap-y-2 border-border border-b py-5 first:pt-0 last:border-b-0 sm:grid-cols-[9rem_1fr]"
        >
          <div className="flex flex-col gap-1">
            <time dateTime={round.announcedOn} className="meta text-fg-subtle">
              {formatDate(round.announcedOn)}
            </time>
            <span className="font-medium">
              {roundTypeLabel(round.roundType) ?? round.roundType}
            </span>
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <Money
                className="text-lg"
                amountUsd={round.amountUsd}
                isUndisclosed={round.isUndisclosed}
                currency={round.currency}
                amountOriginal={round.amountOriginal}
              />
              {round.valuationUsd !== null && (
                <span className="text-fg-muted text-sm">
                  at <Money amountUsd={round.valuationUsd} /> valuation
                </span>
              )}
              {DEBT_LIKE.has(round.roundClass) && (
                <span className="meta text-fg-subtle">
                  Not counted in total raised
                </span>
              )}
            </p>
            {round.investors.length > 0 && (
              <p className="text-fg-muted text-sm">
                {round.investors.map((investor, index) => (
                  <span key={investor.slug}>
                    {index > 0 && ", "}
                    <Link
                      href={paths.investor(investor.slug)}
                      prefetch={false}
                      className="text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg"
                    >
                      {investor.name}
                    </Link>
                    {investor.isLead && (
                      <span className="text-fg-subtle"> (lead)</span>
                    )}
                  </span>
                ))}
              </p>
            )}
            <p className="text-sm">
              <span className="text-fg-subtle">Source: </span>
              <ExternalLink href={round.sourceUrl}>
                {round.sourceTitle ?? "Announcement"}
              </ExternalLink>
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
