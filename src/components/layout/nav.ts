// The public site's sections, shared by the header, the landing's floating nav and the footer.

export const SECTIONS = [
  { href: "/", label: "Explore" },
  { href: "/companies", label: "Companies" },
  { href: "/news", label: "News" },
  { href: "/categories", label: "Categories" },
] as const;

/** The section a path belongs to: `/companies/acme` is still Companies. */
export function sectionFor(pathname: string): string | undefined {
  return [...SECTIONS]
    .sort((a, b) => b.href.length - a.href.length)
    .find(({ href }) =>
      href === "/"
        ? pathname === "/"
        : pathname === href || pathname.startsWith(`${href}/`),
    )?.href;
}
