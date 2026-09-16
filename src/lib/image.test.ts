import { describe, expect, it } from "vitest";
import type { Image } from "@/types/public";
import { blurBackgroundOf, initialsOf, srcSetOf } from "./image";

const image = (overrides: Partial<Image> = {}): Image => ({
  url: "https://x.public.blob.vercel-storage.com/a-1200.webp",
  blurDataUrl: null,
  width: 1200,
  height: 630,
  variants: [
    { width: 640, url: "https://x.public.blob.vercel-storage.com/a-640.webp" },
    {
      width: 1200,
      url: "https://x.public.blob.vercel-storage.com/a-1200.webp",
    },
  ],
  ...overrides,
});

describe("srcSetOf", () => {
  it("lists every variant with its width", () => {
    expect(srcSetOf(image())).toBe(
      "https://x.public.blob.vercel-storage.com/a-640.webp 640w, https://x.public.blob.vercel-storage.com/a-1200.webp 1200w",
    );
  });

  it("drops variants whose URL would corrupt the list", () => {
    expect(
      srcSetOf(
        image({
          variants: [
            { width: 640, url: "https://x.test/a b.webp" },
            { width: 800, url: "https://x.test/a,b.webp" },
          ],
        }),
      ),
    ).toBeUndefined();
  });
});

describe("blurBackgroundOf", () => {
  it("wraps a base64 image data URL", () => {
    expect(
      blurBackgroundOf(
        image({ blurDataUrl: "data:image/webp;base64,UklGRg==" }),
      ),
    ).toBe('url("data:image/webp;base64,UklGRg==")');
  });

  it.each([
    'data:image/webp;base64,AAA"); background: url("https://evil.test/x',
    "https://evil.test/x.png",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:text/html;base64,PHNjcmlwdD4=",
  ])("refuses %s", (blurDataUrl) => {
    expect(blurBackgroundOf(image({ blurDataUrl }))).toBeNull();
  });
});

describe("initialsOf", () => {
  it.each([
    ["Ada Lovelace", "AL"],
    ["Grace Brewster Murray Hopper", "GH"],
    ["stripe", "S"],
    ["  émile   zola ", "ÉZ"],
    ["", "?"],
  ])("%s → %s", (name, expected) => {
    expect(initialsOf(name)).toBe(expected);
  });
});
