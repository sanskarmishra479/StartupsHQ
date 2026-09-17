import { expect, test } from "@playwright/test";

// docs/TEST_PLAN.md §10 `categories.spec.ts` (FR-107, FR-108): real, thin and random-slug cases,
// across all five route shapes. Runs against a production build of the seeded fixtures.

/** The robots meta content, or null when the page has none (an indexable page). */
async function robotsOf(page: import("@playwright/test").Page) {
  const meta = page.locator('meta[name="robots"]');
  return (await meta.count()) === 0
    ? null
    : meta.first().getAttribute("content");
}

test("the directory lists facets with companies and links to each", async ({
  page,
}) => {
  await page.goto("/categories");
  for (const heading of [
    "Industries",
    "Stages",
    "Work type",
    "Cities",
    "Countries",
  ]) {
    await expect(
      page.getByRole("heading", { level: 2, name: heading }),
    ).toBeVisible();
  }
  await expect(
    page.locator('main a[href="/categories/industries/ai"]'),
  ).toBeVisible();
  // Quantum Computing's only company is a draft, so it is not a category.
  await expect(
    page.locator('main a[href="/categories/industries/quantum"]'),
  ).toHaveCount(0);
});

test("a real, indexable category renders its companies and stays indexable", async ({
  page,
}) => {
  const response = await page.goto("/categories/industries/ai");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { level: 1, name: "AI startups" }),
  ).toBeVisible();
  await expect(page.locator('main a[href^="/companies/"]')).toHaveCount(8);
  expect(await robotsOf(page)).toBeNull();
});

test("a thin category renders but is noindex", async ({ page }) => {
  const response = await page.goto("/categories/industries/robotics");
  expect(response?.status()).toBe(200);
  expect(await robotsOf(page)).toContain("noindex");
});

test("every route shape serves a real value", async ({ request }) => {
  for (const path of [
    "/categories/stages/series-a",
    "/categories/work-type/remote",
    "/categories/locations/cities/berlin-de",
    "/categories/locations/countries/india",
  ]) {
    expect((await request.get(path)).status(), path).toBe(200);
  }
});

test("values that do not exist, or have no published company, are real 404s", async ({
  request,
}) => {
  for (const path of [
    "/categories/industries/anything-at-all",
    "/categories/industries/quantum",
    "/categories/stages/unicorn",
    "/categories/locations/cities/atlantis-xx",
    "/categories/people/ai",
  ]) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
});

test("every category a company page links to resolves", async ({
  page,
  request,
}) => {
  await page.goto("/companies/kiln-analytics");
  const hrefs = await page
    .locator('main a[href^="/categories/"]')
    .evaluateAll((links) =>
      links.map((link) => link.getAttribute("href") ?? ""),
    );
  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs) {
    expect((await request.get(href)).status(), href).toBe(200);
  }
});
