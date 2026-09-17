import { expect, type Page, test } from "@playwright/test";

// docs/PRD.md §8 and TEST_PLAN §10 `graph.spec.ts`: the graph can be walked by clicks alone, with
// no dead ends. Runs against a production build of the seeded fixture database.

const ENTITY_PAGE =
  /^\/(companies|founders|investors|batches)\/[a-z0-9-]+$|^\/news$/;

async function follow(page: Page, href: string) {
  await page.locator(`main a[href="${href}"]`).first().click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  // Next.js keeps recently visited pages mounted but hidden, so count only the visible heading.
  await expect(page.locator("h1:visible")).toHaveCount(1);
}

test("walks company → founder → earlier company → investor → portfolio → batch → cohort by clicks", async ({
  page,
}) => {
  await page.goto("/companies");
  await follow(page, "/companies/kiln-analytics");
  await follow(page, "/founders/mira-okafor");
  await follow(page, "/companies/lanternfish-ai");
  await follow(page, "/investors/northwind-ventures");
  await follow(page, "/companies/tidewater-labs");

  await page.goto("/companies/lanternfish-ai");
  const batch = page.locator('main a[href^="/batches/"]').first();
  const batchHref = (await batch.getAttribute("href")) ?? "";
  await follow(page, batchHref);
  const cohortCompany = page.locator('main ul[aria-label="Cohort"] a').first();
  await follow(page, (await cohortCompany.getAttribute("href")) ?? "");
});

test("every entity link reachable from a company page resolves", async ({
  page,
  request,
}) => {
  // Dozens of pages, each rendered on first request by a fresh production server.
  test.setTimeout(180_000);
  const queue = ["/companies/kiln-analytics"];
  const seen = new Set(queue);
  while (queue.length > 0) {
    const path = queue.shift() as string;
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    const hrefs = await page
      .locator("main a[href^='/']")
      .evaluateAll((links) =>
        links.map(
          (link) => (link.getAttribute("href") ?? "").split(/[?#]/)[0] ?? "",
        ),
      );
    for (const href of hrefs) {
      if (ENTITY_PAGE.test(href) && !seen.has(href)) {
        seen.add(href);
        queue.push(href);
      }
    }
  }
  expect(seen.size).toBeGreaterThan(20);

  // Old slugs redirect permanently; hidden and unknown records are real 404s.
  const old = await request.get("/companies/kiln-data", { maxRedirects: 0 });
  expect([301, 308]).toContain(old.status());
  expect(old.headers().location).toMatch(/\/companies\/kiln-analytics$/);
  for (const hidden of [
    "/companies/stealth-draft-co",
    "/investors/old-mill-ventures",
    "/founders/nobody",
  ]) {
    expect((await request.get(hidden)).status(), hidden).toBe(404);
  }
});
