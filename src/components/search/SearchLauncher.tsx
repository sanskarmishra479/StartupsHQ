"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/lib/cx";
import { SearchIcon } from "../ui/icons";
import { PillButton, type PillSize } from "../ui/PillButton";
import { SearchPalette, type SearchPaletteHandle } from "./SearchPalette";

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * The Search pill. A real link to /search, so it works before hydration and opens in a new tab
 * when asked; a plain click, ⌘K / Ctrl+K anywhere, or "/" outside a text field opens the palette.
 */
export function SearchLauncher({
  size = "md",
  className,
}: Readonly<{ size?: PillSize; className?: string }>) {
  const palette = useRef<SearchPaletteHandle>(null);
  const [shortcut, setShortcut] = useState<string | null>(null);

  useEffect(() => {
    setShortcut(
      /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
        ? "⌘K"
        : "Ctrl K",
    );
    const onKeyDown = (event: KeyboardEvent) => {
      const commandK =
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "k";
      const slash =
        event.key === "/" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !isEditable(event.target);
      if (!commandK && !slash) return;
      event.preventDefault();
      palette.current?.open();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <PillButton
        href="/search"
        prefetch={false}
        size={size}
        aria-label="Search"
        aria-keyshortcuts="Meta+K Control+K /"
        aria-haspopup="dialog"
        className={className}
        onClick={(event) => {
          if (
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          )
            return;
          event.preventDefault();
          palette.current?.open();
        }}
      >
        <SearchIcon />
        <span className="hidden sm:inline">Search</span>
        {shortcut && (
          <span
            aria-hidden="true"
            className={cx(
              "meta hidden rounded-sm px-1 opacity-60 lg:inline",
              size === "sm" && "text-[0.625rem]",
            )}
          >
            {shortcut}
          </span>
        )}
      </PillButton>
      <SearchPalette ref={palette} />
    </>
  );
}
