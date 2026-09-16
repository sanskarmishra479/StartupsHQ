import { cx } from "@/lib/cx";
import { initialsOf } from "@/lib/image";

type InitialsAvatarProps = Readonly<{
  name: string;
  /**
   * Hide it from assistive technology when the name is already next to it, as in a card. Labelled
   * by the name otherwise (NFR-04).
   */
  decorative?: boolean;
  shape?: "circle" | "square";
  className?: string;
}>;

/** Stands in for a missing logo or photo — founders have no photo unless one is licensed (ADR-019). */
export function InitialsAvatar({
  name,
  decorative = false,
  shape = "circle",
  className,
}: InitialsAvatarProps) {
  const classes = cx(
    "inline-flex shrink-0 select-none items-center justify-center border border-border bg-placeholder font-medium font-mono text-fg-muted uppercase",
    shape === "circle" ? "rounded-pill" : "rounded-sm",
    className ?? "size-10 text-sm",
  );
  const initials = initialsOf(name);
  if (decorative) {
    return (
      <span aria-hidden="true" className={classes}>
        {initials}
      </span>
    );
  }
  return (
    <span role="img" aria-label={name} className={classes}>
      {initials}
    </span>
  );
}
