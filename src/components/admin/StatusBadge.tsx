import { cx } from "@/lib/cx";
import { type RecordStatus, STATUS_LABELS } from "./entities";

/** Shape and text, never colour alone, tell the statuses apart (NFR-04). */
export function StatusBadge({ status }: Readonly<{ status: RecordStatus }>) {
  return (
    <span
      className={cx(
        "meta inline-flex h-5 items-center gap-1.5 rounded-pill border px-2",
        status === "published" && "border-border-strong text-fg",
        status === "draft" && "border-border border-dashed text-fg-muted",
        status === "archived" &&
          "border-transparent bg-surface-raised text-fg-subtle",
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          "size-1.5 rounded-pill",
          status === "published" && "bg-fg",
          status === "draft" && "border border-fg-muted",
          status === "archived" && "bg-fg-subtle",
        )}
      />
      {STATUS_LABELS[status]}
    </span>
  );
}
