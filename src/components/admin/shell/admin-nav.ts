// The admin panel's sections (SRS §6.2). Client-safe.

export type AdminNavItem = Readonly<{
  href: string;
  label: string;
  adminOnly?: boolean;
}>;

export const ADMIN_NAV: readonly Readonly<{
  label: string;
  items: readonly AdminNavItem[];
}>[] = [
  { label: "Overview", items: [{ href: "/admin", label: "Dashboard" }] },
  {
    label: "Directory",
    items: [
      { href: "/admin/startups", label: "Startups" },
      { href: "/admin/founders", label: "Founders" },
      { href: "/admin/investors", label: "Investors" },
      { href: "/admin/batches", label: "Batches" },
      { href: "/admin/rounds", label: "Rounds" },
    ],
  },
  {
    label: "Tools",
    items: [
      { href: "/admin/import", label: "Import" },
      { href: "/admin/media", label: "Media" },
      { href: "/admin/categories", label: "Categories" },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/admin/users", label: "Users", adminOnly: true },
      { href: "/admin/privacy", label: "Privacy", adminOnly: true },
    ],
  },
];

/** The section a path belongs to: `/admin/startups/new` is still Startups. */
export function adminSectionFor(pathname: string): string | undefined {
  return ADMIN_NAV.flatMap((group) => group.items)
    .map((item) => item.href)
    .sort((a, b) => b.length - a.length)
    .find((href) =>
      href === "/admin"
        ? pathname === "/admin"
        : pathname === href || pathname.startsWith(`${href}/`),
    );
}
