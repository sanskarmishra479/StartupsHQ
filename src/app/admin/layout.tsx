import type { Metadata } from "next";
import { connection } from "next/server";

// The admin origin (SRS §6.2). Every page renders per request: the session decides what it shows,
// and only a per-request render carries the CSP nonce Next.js stamps on its scripts (SEC-09).

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · StartupsHQ admin" },
  robots: { index: false, follow: false },
};

/** Nothing here can be prerendered, so navigations into the admin are allowed to wait. */
export const instant = false;

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await connection();
  return <div className="flex min-h-dvh flex-col">{children}</div>;
}
