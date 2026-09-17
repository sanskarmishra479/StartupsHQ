"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { cx } from "@/lib/cx";
import { Logo } from "../../brand/Logo";
import { ThemeToggle } from "../../ui/ThemeToggle";
import { SignOutLink } from "../auth/EnrollFlow";
import { ADMIN_NAV, adminSectionFor } from "./admin-nav";

type ShellUser = Readonly<{ email: string; name: string; isAdmin: boolean }>;

function Nav({
  isAdmin,
  onNavigate,
}: Readonly<{ isAdmin: boolean; onNavigate?: () => void }>) {
  const pathname = usePathname();
  const current = adminSectionFor(pathname);
  return (
    <nav aria-label="Admin" className="flex flex-col gap-5">
      {ADMIN_NAV.map((group) => {
        const items = group.items.filter((item) => isAdmin || !item.adminOnly);
        if (items.length === 0) return null;
        return (
          <div key={group.label} className="flex flex-col gap-1">
            <p className="meta px-2 text-fg-subtle">{group.label}</p>
            <ul className="flex flex-col">
              {items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    prefetch={false}
                    onClick={onNavigate}
                    aria-current={item.href === current ? "page" : undefined}
                    className={cx(
                      "flex h-8 items-center rounded-md px-2 text-sm",
                      item.href === current
                        ? "bg-surface-raised font-medium text-fg"
                        : "text-fg-muted hover:bg-surface-hover hover:text-fg",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function Account({ user }: Readonly<{ user: ShellUser }>) {
  return (
    <div className="flex flex-col gap-2 border-border border-t pt-4">
      <p className="truncate text-sm" title={user.email}>
        {user.name}
      </p>
      <p className="meta truncate text-fg-subtle">
        {user.isAdmin ? "Admin" : "Editor"} · {user.email}
      </p>
      <div className="flex items-center justify-between gap-2">
        <Link
          href="/admin/account"
          prefetch={false}
          className="text-fg-muted text-sm hover:text-fg"
        >
          Account
        </Link>
        <SignOutLink />
      </div>
      <ThemeToggle />
    </div>
  );
}

/**
 * The admin frame: a sidebar on wide screens, a menu button on narrow ones. Which sections show
 * depends on the role, but hiding a link is a courtesy only — every page and every API call checks
 * the role again (SEC-03.5).
 */
export function AdminShell({
  user,
  children,
}: Readonly<{ user: ShellUser; children: ReactNode }>) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

  // biome-ignore lint/correctness/useExhaustiveDependencies: close the menu whenever the page changes.
  useEffect(() => setMenuOpen(false), [pathname]);

  return (
    <div className="flex min-h-dvh flex-1">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-inverse-bg focus:px-3 focus:py-2 focus:text-inverse-fg"
      >
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col justify-between gap-6 overflow-y-auto border-border border-r p-4 lg:flex">
        <div className="flex flex-col gap-6">
          <Link href="/admin" prefetch={false} aria-label="Admin dashboard">
            <Logo wordmark className="text-sm" />
          </Link>
          <Nav isAdmin={user.isAdmin} />
        </div>
        <Account user={user} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-border border-b bg-bg px-4 lg:hidden">
          <Link href="/admin" prefetch={false} aria-label="Admin dashboard">
            <Logo wordmark className="text-sm" />
          </Link>
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls="admin-menu"
            onClick={() => setMenuOpen(!menuOpen)}
            className="h-8 rounded-md border border-border-strong px-3 text-sm"
          >
            {menuOpen ? "Close" : "Menu"}
          </button>
        </header>
        {menuOpen && (
          <div
            id="admin-menu"
            className="flex flex-col gap-6 border-border border-b p-4 lg:hidden"
          >
            <Nav isAdmin={user.isAdmin} onNavigate={() => setMenuOpen(false)} />
            <Account user={user} />
          </div>
        )}
        <main
          id="main"
          tabIndex={-1}
          className="flex w-full min-w-0 flex-1 flex-col gap-6 px-4 py-6 outline-none sm:px-6 lg:px-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
