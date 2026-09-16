import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import { safeExternalUrl } from "@/lib/format";
import { pillClasses } from "../ui/PillButton";

type ExternalLinkProps = Readonly<{
  href: string | null | undefined;
  children: ReactNode;
  variant?: "text" | "pill";
  className?: string;
}>;

/**
 * A link off the site: opens in a new tab, passes no referrer or window handle, and carries no
 * ranking endorsement. Renders nothing for a missing or non-http(s) URL.
 */
export function ExternalLink({
  href,
  children,
  variant = "text",
  className,
}: ExternalLinkProps) {
  const url = safeExternalUrl(href);
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={cx(
        variant === "pill"
          ? pillClasses("outline", "sm")
          : "underline decoration-border-strong underline-offset-4 hover:decoration-fg",
        className,
      )}
    >
      {children}
      <span aria-hidden="true" className="ml-0.5 text-fg-subtle">
        ↗
      </span>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
