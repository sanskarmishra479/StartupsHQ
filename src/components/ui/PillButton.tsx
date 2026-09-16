import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cx } from "@/lib/cx";

export type PillVariant = "solid" | "glass" | "outline";
export type PillSize = "sm" | "md";

const VARIANTS: Record<PillVariant, string> = {
  // The single strongest control in a view, like the reference's white "Let's Talk" pill.
  solid: "bg-inverse-bg text-inverse-fg hover:opacity-90",
  // Chrome floating over content.
  glass: "glass text-fg hover:bg-surface-hover",
  outline: "border border-border-strong text-fg hover:bg-surface-hover",
};

const SIZES: Record<PillSize, string> = {
  sm: "h-8 gap-1.5 px-3 text-xs",
  md: "h-10 gap-2 px-4 text-sm",
};

export function pillClasses(
  variant: PillVariant = "solid",
  size: PillSize = "md",
  className?: string,
) {
  return cx(
    "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-pill font-medium",
    "transition-[background-color,opacity] duration-(--duration-fast) ease-(--ease-out)",
    "disabled:pointer-events-none disabled:opacity-50",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

type Common = Readonly<{
  variant?: PillVariant;
  size?: PillSize;
  className?: string;
  children: ReactNode;
}>;

type AsLink = Common &
  Omit<ComponentProps<typeof Link>, "className" | "children">;
type AsButton = Common &
  Omit<ComponentProps<"button">, "className" | "children"> & {
    href?: undefined;
  };

/** A fully rounded control: a Link when given `href`, otherwise a button. */
export function PillButton(props: AsLink | AsButton) {
  const { variant, size, className, children, ...rest } = props;
  const classes = pillClasses(variant, size, className);
  if ("href" in rest && rest.href !== undefined) {
    return (
      <Link {...(rest as Omit<AsLink, keyof Common>)} className={classes}>
        {children}
      </Link>
    );
  }
  const buttonProps = rest as Omit<AsButton, keyof Common>;
  return (
    <button type="button" {...buttonProps} className={classes}>
      {children}
    </button>
  );
}
