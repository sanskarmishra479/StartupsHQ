import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/admin/PageHeader";
import { formatTimestamp } from "@/components/admin/time";
import { ResponsiveImage } from "@/components/media/ResponsiveImage";
import { cx } from "@/lib/cx";
import { safeExternalUrl } from "@/lib/format";
import { listMedia } from "@/server/services/admin-panel";
import { requirePanel } from "../../_lib/session";

// FR-207: the newest images, and whether each is still staging (deleted after 24 h unless a saved
// record attaches it) or attached.

export const metadata: Metadata = { title: "Media" };

const STATES = ["staging", "attached"] as const;

export default async function MediaPage({
  searchParams,
}: PageProps<"/admin/media">) {
  const { ctx } = await requirePanel();
  const stateParam = (await searchParams).state;
  const state = STATES.find((value) => value === stateParam);
  const items = await listMedia(ctx, state ? { state } : {});

  return (
    <>
      <PageHeader
        title="Media"
        description="Uploads and prefilled images. Staging images are removed after 24 hours unless a saved record uses them."
      />
      <nav aria-label="State">
        <ul className="flex gap-1">
          {[undefined, ...STATES].map((value) => (
            <li key={value ?? "all"}>
              <Link
                href={value ? `/admin/media?state=${value}` : "/admin/media"}
                prefetch={false}
                aria-current={value === state ? "page" : undefined}
                className={cx(
                  "inline-flex h-8 items-center rounded-pill px-3 text-sm capitalize",
                  value === state
                    ? "bg-inverse-bg text-inverse-fg"
                    : "text-fg-muted hover:bg-surface-hover hover:text-fg",
                )}
              >
                {value ?? "All"}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {items.length === 0 ? (
        <p className="rounded-md border border-border border-dashed px-4 py-10 text-center text-fg-muted text-sm">
          No images.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
          {items.map((item) => {
            const source = safeExternalUrl(item.sourceUrl);
            return (
              <li
                key={item.id}
                className="flex flex-col gap-2 rounded-md border border-border p-2"
              >
                <div className="flex aspect-square items-center justify-center overflow-hidden rounded-sm bg-placeholder">
                  {item.image ? (
                    <ResponsiveImage
                      image={item.image}
                      alt=""
                      sizes="200px"
                      fit={item.purpose === "logo" ? "contain" : "cover"}
                      className="size-full"
                    />
                  ) : (
                    <span className="meta text-fg-subtle">No preview</span>
                  )}
                </div>
                <p className="meta text-fg-subtle">
                  {item.purpose} · {item.state}
                </p>
                <p className="text-fg-muted text-xs">
                  {formatTimestamp(item.createdAt)}
                </p>
                <p
                  className="select-all truncate font-mono text-[0.625rem] text-fg-subtle"
                  title="Asset id"
                >
                  {item.id}
                </p>
                {source && (
                  <a
                    href={source}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="truncate text-fg-muted text-xs underline underline-offset-2"
                  >
                    Source
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
