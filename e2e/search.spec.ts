import { expect, test } from "@playwright/test";

// docs/TEST_PLAN.md §10 `search.spec.ts` (FR-109): the palette by keyboard alone, a misspelling,
// a query without its diacritics, and the type tabs. Runs against the seeded fixture database.

test("⌘K opens the palette and a suggestion is chosen by keyboard alone", async ({
  page,
}) => {
  await page.goto("/companies");
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("ControlOrMeta+k");

  const combobox = page.getByRole("combobox", { name: /search companies/i });
  await expect(combobox).toBeFocused();
  await page.keyboard.type("kiln");

  const listbox = page.getByRole("listbox", { name: "Suggestions" });
  await expect(
    listbox.getByRole("option", { name: /Kiln Analytics/ }),
  ).toBeVisible();
  await expect(page.locator("dialog output")).toContainText("suggestion");

  await page.keyboard.press("ArrowDown");
  await expect(combobox).toHaveAttribute("aria-activedescendant", /.+/);
  await expect(listbox.getByRole("option", { selected: true })).toContainText(
    "Kiln Analytics",
  );
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/companies\/kiln-analytics$/);
  await expect(page.locator("h1:visible")).toHaveText("Kiln Analytics");
});

test("Escape closes the palette and Enter with no choice opens the results page", async ({
  page,
}) => {
  await page.goto("/news");
  const launcher = page.getByRole("link", { name: "Search" });
  await launcher.click();
  const combobox = page.getByRole("combobox", { name: /search companies/i });
  await expect(combobox).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(combobox).toBeHidden();

  await page.keyboard.press("/");
  await expect(combobox).toBeFocused();
  await page.keyboard.type("harbor");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=harbor$/);
  await expect(
    page.getByRole("heading", { name: /Investors/, level: 2 }),
  ).toBeVisible();

  // The query is now a recent search, offered when the palette opens empty.
  await page.keyboard.press("ControlOrMeta+k");
  await expect(
    page
      .getByRole("listbox", { name: "Recent searches" })
      .getByRole("option", { name: "harbor" }),
  ).toBeVisible();
});

test("a misspelling finds the company and says it is a close match", async ({
  page,
}) => {
  await page.goto("/search?q=brightpth");
  await expect(
    page.locator("main p").filter({ hasText: /No exact matches for/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Brightpath Health/ }).first(),
  ).toBeVisible();
});

test("queries without diacritics find names that have them", async ({
  page,
}) => {
  await page.goto("/search?q=cafe%20algorithmique");
  await expect(
    page.getByRole("link", { name: /Café Algorithmique/ }).first(),
  ).toBeVisible();

  await page.goto("/search?q=wisla%20robotcs");
  await expect(
    page.getByRole("link", { name: /Wisła Robotics/ }).first(),
  ).toBeVisible();
});

test("type tabs filter the groups and show counts", async ({ page }) => {
  await page.goto("/search?q=capital");
  const tabs = page.getByRole("navigation", { name: "Result types" });
  const investorsTab = tabs.getByRole("link", { name: /Investors \d+/ });
  await expect(investorsTab).toBeVisible();
  await investorsTab.click();
  await expect(page).toHaveURL(/\/search\?q=capital&type=investors$/);
  await expect(investorsTab).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", { level: 2, name: /Investors/ }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 2 })).toHaveCount(1);
  await expect(
    page.getByRole("link", { name: /Harbor Capital/ }),
  ).toBeVisible();
});

test("the results page is not indexed and a short query asks for more", async ({
  page,
}) => {
  const response = await page.goto("/search?q=k");
  expect(response?.status()).toBe(200);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/,
  );
  await expect(page.getByText("Type at least 2 characters.")).toBeVisible();
});
