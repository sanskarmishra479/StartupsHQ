import Link from "next/link";
import { Logo } from "../brand/Logo";
import { SECTIONS } from "./nav";

export function SiteFooter() {
  return (
    // Extra bottom room on phones for the floating section pill.
    <footer className="mt-auto border-border border-t pb-20 md:pb-0">
      <div className="mx-auto flex max-w-screen-2xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="flex flex-col gap-2">
          <Logo wordmark className="text-base" />
          <p className="max-w-xs text-fg-muted text-sm">
            Startups, founders, investors and accelerator batches — connected.
          </p>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {SECTIONS.map(({ href, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  prefetch={false}
                  className="text-fg-muted hover:text-fg"
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
