// Applies the viewer's saved theme before first paint (NFR-06). A same-origin file rather than an
// inline script: the public origin's CSP allows no inline scripts (SEC-09). Keep it tiny and in
// step with THEME_STORAGE_KEY and THEMES in src/lib/theme.ts.
(() => {
  try {
    const theme = localStorage.getItem("theme");
    if (theme === "light" || theme === "system") {
      document.documentElement.setAttribute("data-theme", theme);
    }
  } catch {}
})();
