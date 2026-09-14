import "server-only";

// The only place cache tags are built (NFR-02, ADR-013). Mutations expire every tag they could
// affect; building tag strings anywhere else invites a write that forgets one.

/** Next.js silently ignores longer tags, which would make a revalidation a no-op. */
export const MAX_TAG_LENGTH = 256;

function tag(value: string): string {
  if (value.length > MAX_TAG_LENGTH) {
    throw new Error(`Cache tag exceeds ${MAX_TAG_LENGTH} characters.`);
  }
  return value;
}

export const cacheTags = {
  startup: (slug: string) => tag(`startup:${slug}`),
  founder: (slug: string) => tag(`founder:${slug}`),
  investor: (slug: string) => tag(`investor:${slug}`),
  batch: (slug: string) => tag(`batch:${slug}`),
  category: (kind: string, slug: string) => tag(`category:${kind}:${slug}`),
  startupsList: () => tag("startups:list"),
  news: () => tag("news"),
  categories: () => tag("categories"),
  sitemap: () => tag("sitemap"),
} as const;
