import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  adminPaths,
  ENTITY_INFO,
  entityForSegment,
  STATUS_LABELS,
} from "@/components/admin/entities";
import { Notice } from "@/components/admin/form";
import { PageHeader } from "@/components/admin/PageHeader";
import { RecordTable } from "@/components/admin/records/RecordTable";
import { PillButton } from "@/components/ui/PillButton";
import { cx } from "@/lib/cx";
import { ValidationError } from "@/server/lib/errors";
import { listRecords } from "@/server/services/admin-reads";
import type { AdminListItem, RecordStatus } from "@/types/admin";
import { requirePanel } from "../../_lib/session";

// FR-203: every record of one entity, drafts and archived included, newest edit first.

const PAGE_SIZE = 50;
const STATUSES: readonly RecordStatus[] = ["draft", "published", "archived"];

const one = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export async function generateMetadata({
  params,
}: PageProps<"/admin/[entity]">): Promise<Metadata> {
  const kind = entityForSegment((await params).entity);
  return kind ? { title: ENTITY_INFO[kind].plural } : {};
}

export default async function EntityListPage({
  params,
  searchParams,
}: PageProps<"/admin/[entity]">) {
  const { ctx } = await requirePanel();
  const kind = entityForSegment((await params).entity);
  if (!kind) notFound();
  const info = ENTITY_INFO[kind];
  const query = await searchParams;
  const statusParam = one(query.status);
  const status = STATUSES.find((value) => value === statusParam);
  const q = one(query.q)?.trim().slice(0, 100) ?? "";
  const cursor = one(query.cursor);

  const hrefWith = (next: {
    status?: RecordStatus;
    q?: string;
    cursor?: string;
  }) => {
    const search = new URLSearchParams();
    if (next.status) search.set("status", next.status);
    if (next.q) search.set("q", next.q);
    if (next.cursor) search.set("cursor", next.cursor);
    const value = search.toString();
    return value ? `${adminPaths.list(kind)}?${value}` : adminPaths.list(kind);
  };

  let items: readonly AdminListItem[] = [];
  let nextCursor: string | null = null;
  let staleCursor = false;
  try {
    const page = await listRecords(ctx, kind, {
      ...(status ? { status } : {}),
      ...(q ? { q } : {}),
      ...(cursor ? { cursor } : {}),
      limit: PAGE_SIZE,
    });
    items = page.data;
    nextCursor = page.pagination.nextCursor;
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    staleCursor = true;
  }

  return (
    <>
      <PageHeader
        title={info.plural}
        actions={
          kind === "round" ? undefined : (
            <PillButton href={adminPaths.create(kind)} size="sm">
              New {info.singular.toLowerCase()}
            </PillButton>
          )
        }
        description={
          kind === "round"
            ? "Rounds are added from their startup's page."
            : undefined
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Status">
          <ul className="flex flex-wrap gap-1">
            {[undefined, ...STATUSES].map((value) => (
              <li key={value ?? "all"}>
                <Link
                  href={hrefWith({ status: value, q })}
                  prefetch={false}
                  aria-current={value === status ? "page" : undefined}
                  className={cx(
                    "inline-flex h-8 items-center rounded-pill px-3 text-sm",
                    value === status
                      ? "bg-inverse-bg text-inverse-fg"
                      : "text-fg-muted hover:bg-surface-hover hover:text-fg",
                  )}
                >
                  {value ? STATUS_LABELS[value] : "All"}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <search>
          <form action={adminPaths.list(kind)} className="flex gap-2">
            {status && <input type="hidden" name="status" value={status} />}
            <label className="sr-only" htmlFor="record-search">
              Search {info.plural.toLowerCase()} by name
            </label>
            <input
              id="record-search"
              type="search"
              name="q"
              defaultValue={q}
              maxLength={100}
              placeholder="Search by name"
              className="h-8 w-56 rounded-md border border-border-strong bg-surface px-3 text-sm placeholder:text-fg-subtle"
            />
            <PillButton type="submit" size="sm" variant="outline">
              Search
            </PillButton>
          </form>
        </search>
      </div>

      {staleCursor ? (
        <Notice tone="error" title="This page link has expired">
          <Link href={hrefWith({ status, q })} className="underline">
            Go back to the first page
          </Link>
        </Notice>
      ) : (
        <RecordTable
          key={`${status}-${q}-${cursor}`}
          kind={kind}
          items={items}
        />
      )}

      {(cursor || nextCursor) && (
        <nav aria-label="Pages" className="flex justify-between gap-2">
          {cursor ? (
            <PillButton
              href={hrefWith({ status, q })}
              size="sm"
              variant="outline"
            >
              First page
            </PillButton>
          ) : (
            <span />
          )}
          {nextCursor && (
            <PillButton
              href={hrefWith({ status, q, cursor: nextCursor })}
              size="sm"
              variant="outline"
            >
              Next page
            </PillButton>
          )}
        </nav>
      )}
    </>
  );
}
