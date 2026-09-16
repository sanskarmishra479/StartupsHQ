import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, isTheme, THEME_STORAGE_KEY, THEMES } from "./theme";

// public/theme.js runs before the app's own code, so it cannot import these constants. This keeps
// the two in step.
const script = readFileSync(
  new URL("../../public/theme.js", import.meta.url),
  "utf8",
);

function applied(stored: string | null | Error): string | null {
  const attributes = new Map<string, string>();
  runInNewContext(script, {
    localStorage: {
      getItem(key: string) {
        if (stored instanceof Error) throw stored;
        return key === THEME_STORAGE_KEY ? stored : null;
      },
    },
    document: {
      documentElement: {
        setAttribute: (name: string, value: string) =>
          attributes.set(name, value),
      },
    },
  });
  return attributes.get("data-theme") ?? null;
}

describe("public/theme.js", () => {
  it.each(
    THEMES.filter((theme) => theme !== DEFAULT_THEME),
  )("applies a stored %s theme", (theme) => {
    expect(applied(theme)).toBe(theme);
  });

  it("leaves the default theme to the stylesheet", () => {
    expect(applied(DEFAULT_THEME)).toBeNull();
    expect(applied(null)).toBeNull();
  });

  it("ignores anything that is not a theme", () => {
    expect(applied('light" onload="x')).toBeNull();
    expect(isTheme('light" onload="x')).toBe(false);
  });

  it("survives storage that throws, as in some private windows", () => {
    expect(applied(new Error("SecurityError"))).toBeNull();
  });
});
