// Joins class names, skipping the falsy ones. Client-safe.
export function cx(
  ...classes: ReadonlyArray<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(" ");
}
