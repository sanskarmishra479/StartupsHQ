"use client";

import { useSyncExternalStore } from "react";
import {
  DEFAULT_THEME,
  isTheme,
  THEME_STORAGE_KEY,
  type Theme,
} from "@/lib/theme";
import { IconToggle } from "./IconToggle";
import { MonitorIcon, MoonIcon, SunIcon } from "./icons";

const listeners = new Set<() => void>();

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab changing the theme.
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function applyTheme(theme: Theme) {
  if (theme === DEFAULT_THEME) {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
  for (const listener of listeners) listener();
}

const OPTIONS = [
  { value: "dark", label: "Dark theme", icon: <MoonIcon /> },
  { value: "light", label: "Light theme", icon: <SunIcon /> },
  { value: "system", label: "Match system theme", icon: <MonitorIcon /> },
] as const;

/**
 * Dark, light or system (NFR-06). Persisted per viewer in localStorage, never a cookie, so public
 * pages stay static; THEME_INIT_SCRIPT applies it before paint on the next load.
 */
export function ThemeToggle({ className }: Readonly<{ className?: string }>) {
  // The server cannot know the stored theme, so nothing is pressed until hydration.
  const theme = useSyncExternalStore(subscribe, readTheme, () => null);
  return (
    <IconToggle
      label="Theme"
      options={OPTIONS}
      value={theme}
      onChange={applyTheme}
      className={className}
    />
  );
}
