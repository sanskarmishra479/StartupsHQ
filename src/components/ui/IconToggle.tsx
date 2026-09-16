"use client";

import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

export type IconToggleOption<Value extends string> = Readonly<{
  value: Value;
  label: string;
  icon: ReactNode;
}>;

type IconToggleProps<Value extends string> = Readonly<{
  options: readonly IconToggleOption<Value>[];
  /** Null while the value is not yet known, such as a stored preference before hydration. */
  value: Value | null;
  onChange: (value: Value) => void;
  /** Names the group, e.g. "View" or "Theme". */
  label: string;
  className?: string;
}>;

/**
 * A row of icon buttons choosing one value, such as grid ↔ list. Each button is labelled and
 * reports its state with aria-pressed, so the icons need no visible text.
 */
export function IconToggle<Value extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: IconToggleProps<Value>) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would need a legend and form styling; role="group" names the set.
    <div
      role="group"
      aria-label={label}
      className={cx(
        "glass inline-flex items-center gap-0.5 rounded-pill p-1",
        className,
      )}
    >
      {options.map((option) => {
        const pressed = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-label={option.label}
            aria-pressed={pressed}
            title={option.label}
            onClick={() => onChange(option.value)}
            className={cx(
              "inline-flex size-8 items-center justify-center rounded-pill",
              "transition-colors duration-(--duration-fast) ease-(--ease-out)",
              pressed
                ? "bg-inverse-bg text-inverse-fg"
                : "text-fg hover:bg-surface-hover",
            )}
          >
            {option.icon}
          </button>
        );
      })}
    </div>
  );
}
