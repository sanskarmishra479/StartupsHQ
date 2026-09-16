import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// NFR-04: ≥ 4.5:1 contrast for text in both themes, checked against the tokens themselves so a
// colour change in globals.css cannot quietly make the interface illegible.

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

type Rgba = { r: number; g: number; b: number; a: number };
type Tokens = Record<string, string>;

/** The custom properties declared in the first rule whose selector list matches `selector`. */
function tokensOf(selector: RegExp): Tokens {
  const match = selector.exec(css);
  if (!match) throw new Error(`No rule matches ${selector}`);
  const open = css.indexOf("{", match.index + match[0].length - 1);
  const close = css.indexOf("}", open);
  const tokens: Tokens = {};
  for (const [, name, value] of css
    .slice(open + 1, close)
    .matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    tokens[name as string] = (value as string).trim();
  }
  return tokens;
}

function parse(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = Number.parseInt(hex[1] as string, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const rgb = /^rgb\((\d+) (\d+) (\d+)(?: \/ ([\d.]+))?\)$/.exec(value);
  if (rgb) {
    const [, r, g, b, a] = rgb;
    return {
      r: +(r as string),
      g: +(g as string),
      b: +(b as string),
      a: a ? +a : 1,
    };
  }
  throw new Error(`Unsupported colour: ${value}`);
}

function over(top: Rgba, bottom: Rgba): Rgba {
  const mix = (t: number, u: number) => t * top.a + u * (1 - top.a);
  return {
    r: mix(top.r, bottom.r),
    g: mix(top.g, bottom.g),
    b: mix(top.b, bottom.b),
    a: 1,
  };
}

function luminance({ r, g, b }: Rgba): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES = {
  dark: tokensOf(/:root,\s*\[data-theme="dark"\]\s*\{/),
  light: tokensOf(/^\[data-theme="light"\]\s*\{/m),
};

const TEXT = ["fg", "fg-muted", "fg-subtle"];
const BACKGROUNDS = [
  "bg",
  "surface",
  "surface-raised",
  "surface-hover",
  "placeholder",
];

describe.each(Object.entries(THEMES))("%s theme tokens", (_theme, tokens) => {
  const color = (name: string) => {
    const value = tokens[name];
    if (value === undefined) throw new Error(`Missing token --${name}`);
    return parse(value);
  };
  const ratio = (fg: string, bg: string) => contrast(color(fg), color(bg));

  it.each(
    TEXT.flatMap((text) => BACKGROUNDS.map((bg) => [text, bg])),
  )("--%s on --%s is at least 4.5:1", (text, bg) => {
    expect(ratio(text as string, bg as string)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["inverse-fg", "inverse-bg"],
    ["accent-fg", "accent"],
    ["danger", "bg"],
    ["danger", "surface"],
  ])("--%s on --%s is at least 4.5:1", (fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps --fg legible on frosted chrome over any content, black or white", () => {
    for (const beneath of [parse("#000000"), parse("#ffffff")]) {
      const glass = over(color("glass"), beneath);
      expect(contrast(color("fg"), glass)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("gives the focus ring at least 3:1 against the page (WCAG 1.4.11)", () => {
    expect(ratio("focus-ring", "bg")).toBeGreaterThanOrEqual(3);
    expect(ratio("focus-ring", "surface")).toBeGreaterThanOrEqual(3);
  });
});

describe("theme blocks", () => {
  it('declares the same tokens for "system" under a light preference as for "light"', () => {
    const system = tokensOf(
      /@media \(prefers-color-scheme: light\)\s*\{\s*\[data-theme="system"\]\s*\{/,
    );
    expect(system).toEqual(THEMES.light);
  });

  it("declares every token in both themes", () => {
    expect(Object.keys(THEMES.light).sort()).toEqual(
      Object.keys(THEMES.dark).sort(),
    );
  });
});
