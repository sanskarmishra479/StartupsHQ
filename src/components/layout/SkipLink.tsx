/** The first stop for keyboard users: straight past the chrome to the page's content (NFR-04). */
export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-pill focus:bg-inverse-bg focus:px-4 focus:py-2 focus:font-medium focus:text-inverse-fg focus:text-sm"
    >
      Skip to content
    </a>
  );
}
