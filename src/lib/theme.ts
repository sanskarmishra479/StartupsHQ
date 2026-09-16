// Theme preference (NFR-06). Client-safe. /public/theme.js applies the stored value before first
// paint and must accept exactly the values listed here.

export const THEMES = ["dark", "light", "system"] as const;
export type Theme = (typeof THEMES)[number];

/** Dark is the default look (TODO Phase 13). */
export const DEFAULT_THEME: Theme = "dark";

export const THEME_STORAGE_KEY = "theme";

export function isTheme(value: unknown): value is Theme {
  return THEMES.some((theme) => theme === value);
}
