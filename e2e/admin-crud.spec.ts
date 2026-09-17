import { createHmac } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";

// docs/TEST_PLAN.md §10 `admin-crud.spec.ts` and TODO Phase 18's exit: sign in with TOTP on the
// admin origin, then add a company with 2 founders (1 created inline), 3 investors, a batch and a
// EUR round, publish it, and find it on the public site. Timed.
//
// It needs a real enrolled admin on the database the server uses, given by environment:
//   E2E_ADMIN_ORIGIN       e.g. http://admin.localhost:3100
//   E2E_ADMIN_EMAIL        E2E_ADMIN_PASSWORD        E2E_ADMIN_TOTP_SECRET (base32)
// and an ECB EUR rate within 7 days before E2E_ROUND_DATE (default 2026-03-01, which the seeded
// fixtures cover). Without them the spec is skipped.

const env = {
  origin: process.env.E2E_ADMIN_ORIGIN,
  email: process.env.E2E_ADMIN_EMAIL,
  password: process.env.E2E_ADMIN_PASSWORD,
  secret: process.env.E2E_ADMIN_TOTP_SECRET,
  roundDate: process.env.E2E_ROUND_DATE ?? "2026-03-01",
};

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 6238, as an authenticator app computes it. */
function totp(secret: string, at = Date.now()): string {
  let bits = "";
  for (const char of secret.replace(/=+$/, "").toUpperCase()) {
    bits += BASE32.indexOf(char).toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes))
    .update(counter)
    .digest();
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  return String(
    (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000,
  ).padStart(6, "0");
}

async function pick(page: Page, label: string, query: string, option: RegExp) {
  const box = page.getByRole("combobox", { name: label });
  await box.fill(query);
  await page.getByRole("option", { name: option }).first().click();
}

test.skip(
  !env.origin || !env.email || !env.password || !env.secret,
  "Set E2E_ADMIN_ORIGIN, E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD and E2E_ADMIN_TOTP_SECRET.",
);

test("adds a company with founders, investors, a batch and a EUR round, then publishes it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const origin = env.origin as string;
  const suffix = Date.now().toString(36);
  const name = `Timed Test Co ${suffix}`;
  const newFounder = `Inline Founder ${suffix}`;

  await page.goto(`${origin}/admin/login`);
  await page.getByLabel("Email").fill(env.email as string);
  await page.getByLabel("Password").fill(env.password as string);
  await page.getByRole("button", { name: "Continue" }).click();
  // The next time step: a code already used to sign in is not accepted twice.
  await page
    .getByLabel("Code")
    .fill(totp(env.secret as string, Date.now() + 30_000));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(`${origin}/admin`);

  const started = Date.now();
  await page.goto(`${origin}/admin/startups/new`);

  await page.getByLabel(/^Name/).fill(name);
  await page.getByLabel("Tagline").fill("Created by the timed admin test.");
  await pick(page, "Headquarters", "Berlin", /Berlin/);
  await pick(page, "Add an industry", "Developer", /Developer Tools/);

  // Founder 1 exists; founder 2 is created inline as a draft.
  await pick(page, "Add a founder", "Mira", /Mira Okafor/);
  await page.getByRole("button", { name: "Add founder" }).click();
  await page.getByRole("combobox", { name: "Add a founder" }).fill(newFounder);
  await page
    .getByRole("option", {
      name: new RegExp(`Create draft founder “${newFounder}”`),
    })
    .click();
  await page.getByLabel("Source URL").fill("https://example.com/team");
  await page.getByRole("button", { name: "Add founder" }).click();
  await expect(page.getByText(newFounder)).toBeVisible();

  // Two backers without a known round, and a lead in the round.
  await pick(page, "Add an investor", "Northwind", /Northwind Ventures/);
  await pick(page, "Add an investor", "Harbor", /Harbor Capital/);
  await pick(page, "Add a batch", "Parallel", /Parallel Accelerator/);

  await page.getByRole("button", { name: "Add round" }).click();
  const round = page.getByRole("dialog", { name: "Add a round" });
  await round.getByLabel(/^Round/).selectOption("series_a");
  await round.getByLabel(/^Announced/).fill(env.roundDate);
  await round.getByLabel("Currency").selectOption("EUR");
  await round.getByLabel("Amount", { exact: true }).fill("20000000");
  await round
    .getByLabel(/^Source URL/)
    .fill("https://example.com/news/series-a");
  await round
    .getByRole("combobox", { name: "Add a participant" })
    .fill("Fjord");
  await round
    .getByRole("option", { name: /Fjord Kapital/ })
    .first()
    .click();
  await round.getByRole("button", { name: "Add round" }).click();
  await expect(round).toBeHidden();

  await page.getByRole("button", { name: "Publish" }).click();
  await expect(
    page
      .getByRole("complementary", { name: "Record" })
      .getByText("Published", { exact: true }),
  ).toBeVisible({
    timeout: 20_000,
  });
  const elapsed = (Date.now() - started) / 1000;
  console.log(
    `admin-crud: company added and published in ${elapsed.toFixed(1)} s`,
  );
  expect(elapsed).toBeLessThan(90);

  // The saved record carries every link. Next.js keeps the previous page mounted but hidden, so
  // only visible text counts.
  await expect(page).toHaveURL(/\/admin\/startups\/[0-9a-f-]{36}$/);
  const visible = (text: string | RegExp) =>
    page.getByText(text).locator("visible=true");
  await expect(visible(/Mira Okafor · Co-founder/)).toHaveCount(1);
  await expect(visible(newFounder)).toHaveCount(1);
  await expect(visible(/Fjord Kapital \(lead\)/)).toHaveCount(1);
  await expect(visible("Northwind Ventures")).toHaveCount(1);
  await expect(visible("Harbor Capital")).toHaveCount(1);
  await expect(visible(/Parallel Accelerator/)).toHaveCount(1);

  // And the public site shows it, with the round's original currency.
  const slug =
    (
      await page.locator("dd.font-mono").locator("visible=true").textContent()
    )?.trim() ?? "";
  const publicOrigin = origin.replace("admin.", "");
  await page.goto(`${publicOrigin}/companies/${slug}`);
  await expect(page.locator("h1:visible")).toHaveText(name);
  await expect(page.getByText("€20M").first()).toBeVisible();
});
