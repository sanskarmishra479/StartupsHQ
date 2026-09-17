// Theme preference (NFR-06). Client-safe.

export const THEMES = ["dark", "light", "system"] as const;
export type Theme = (typeof THEMES)[number];

/** Dark is the default look (TODO Phase 13). */
export const DEFAULT_THEME: Theme = "dark";

export const THEME_STORAGE_KEY = "theme";

export function isTheme(value: unknown): value is Theme {
  return THEMES.some((theme) => theme === value);
}

/**
 * Inlined into <head> by the root layout, so the saved theme applies before first paint. The
 * default needs no attribute, and anything but a known theme is ignored. Plain ES5, no imports:
 * it runs before any bundle.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(${THEMES.filter((theme) => theme !== DEFAULT_THEME)
  .map((theme) => `t===${JSON.stringify(theme)}`)
  .join(
    "||",
  )})document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

/**
 * The script's SHA-256 as a CSP source. The admin origin's policy allows inline scripts only by
 * nonce or by this hash, so the theme applies before paint there too without reading the nonce in
 * the shared root layout, which would make every public page dynamic (SEC-09, ADR-022).
 * theme.test.ts recomputes it, so editing the script without updating this fails the tests.
 */
export const THEME_INIT_SCRIPT_HASH =
  "'sha256-K22ykbNzOuHzdq7T0uCZ8M+BhcHou87o+zyUbnYcNhU='";
