// Test double for `next/cache`, aliased in vitest.config.mts. Outside a Next.js render the real
// `cacheTag` and `cacheLife` throw, so tests use this to record which tags, lifetimes and
// revalidations a cached read or a write asked for. It performs no caching.

export type CacheCall = Readonly<{
  fn: "cacheTag" | "cacheLife" | "revalidateTag" | "updateTag";
  args: readonly unknown[];
}>;

export const cacheCalls: CacheCall[] = [];

export function resetCacheCalls(): void {
  cacheCalls.length = 0;
}

export function cacheTag(...tags: string[]): void {
  cacheCalls.push({ fn: "cacheTag", args: tags });
}

export function cacheLife(profile: unknown): void {
  cacheCalls.push({ fn: "cacheLife", args: [profile] });
}

export function revalidateTag(tag: string, profile: unknown): void {
  cacheCalls.push({ fn: "revalidateTag", args: [tag, profile] });
}

export function updateTag(tag: string): void {
  cacheCalls.push({ fn: "updateTag", args: [tag] });
}
