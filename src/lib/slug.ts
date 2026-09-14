// Slugs: lowercase ASCII words joined by single hyphens (FR-403).
// Client-safe — the admin form previews slugs as editors type.

export const MAX_SLUG_LENGTH = 80;

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Letters that Unicode normalization does not decompose into a base letter plus accent. */
const SPECIAL_LETTERS: Readonly<Record<string, string>> = {
  ß: "ss",
  æ: "ae",
  œ: "oe",
  ø: "o",
  ł: "l",
  đ: "d",
  ð: "d",
  þ: "th",
  ı: "i",
};

/**
 * "Café Algorithmique" → "cafe-algorithmique", "Wisła Robotics" → "wisla-robotics".
 *
 * Returns "" when the name has no Latin letters or digits (e.g. "佐藤 花子"). Callers must then
 * ask the editor for a slug rather than invent a meaningless one.
 */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[ßæœøłđðþı]/g, (letter) => SPECIAL_LETTERS[letter] ?? letter)
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug.slice(0, MAX_SLUG_LENGTH).replace(/-+$/, "");
}

/** Matches the database's slug check constraint. */
export function isSlug(value: string): boolean {
  return value.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(value);
}

/** "acme" → "acme", "acme-2", "acme-3", … keeping the result within MAX_SLUG_LENGTH. */
export function withSuffix(base: string, attempt: number): string {
  if (attempt <= 1) return base;
  const suffix = `-${attempt}`;
  const trimmed = base
    .slice(0, MAX_SLUG_LENGTH - suffix.length)
    .replace(/-+$/, "");
  return `${trimmed}${suffix}`;
}
