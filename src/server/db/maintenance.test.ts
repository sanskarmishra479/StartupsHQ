import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyAuditRetention } from "./audit-retention";
import { closeDb, getDb } from "./client";
import { importFxRates, parseEcbRates } from "./fx-import";
import { auditLog, fxRates } from "./schema";

// The scheduled jobs (SEC-11, FR-406). Both are idempotent and safe to re-run, which is what
// makes a weekly cron acceptable.

const daysAgo = (days: number) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000);

beforeAll(async () => {
  await getDb().delete(fxRates).where(eq(fxRates.source, "ecb"));
});

afterAll(async () => {
  await closeDb();
});

describe("audit retention (SEC-11)", () => {
  it("clears addresses after 90 days and removes rows after a year", async () => {
    const db = getDb();
    const [recent, older, ancient] = await db
      .insert(auditLog)
      .values([
        {
          entityType: "startup",
          action: "create",
          ip: "203.0.113.10",
          createdAt: daysAgo(1),
        },
        {
          entityType: "startup",
          action: "update",
          ip: "203.0.113.11",
          createdAt: daysAgo(120),
        },
        {
          entityType: "startup",
          action: "publish",
          ip: "203.0.113.12",
          createdAt: daysAgo(400),
        },
      ])
      .returning({ id: auditLog.id });

    const result = await applyAuditRetention(db);
    expect(result.ipsCleared).toBeGreaterThanOrEqual(1);
    expect(result.rowsDeleted).toBeGreaterThanOrEqual(1);

    const rows = await db
      .select({ id: auditLog.id, ip: auditLog.ip })
      .from(auditLog)
      .where(
        inArray(auditLog.id, [
          recent?.id ?? "",
          older?.id ?? "",
          ancient?.id ?? "",
        ]),
      );
    const byId = new Map(rows.map((row) => [row.id, row.ip]));

    // What changed, and when: a fresh row keeps its address, a 120-day-old row loses it, and a
    // row past a year is gone entirely.
    expect(byId.get(recent?.id ?? "")).toBe("203.0.113.10");
    expect(byId.has(older?.id ?? "")).toBe(true);
    expect(byId.get(older?.id ?? "")).toBeNull();
    expect(byId.has(ancient?.id ?? "")).toBe(false);
  });

  it("is safe to run twice", async () => {
    const second = await applyAuditRetention(getDb());
    expect(second.ipsCleared).toBe(0);
    expect(second.rowsDeleted).toBe(0);
  });
});

describe("the ECB rate import (FR-406)", () => {
  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01">
  <Cube><Cube time='2026-09-15'>
    <Cube currency='USD' rate='1.0842'/>
    <Cube currency='GBP' rate='0.8461'/>
    <Cube currency='JPY' rate='171.35'/>
  </Cube></Cube>
</gesmes:Envelope>`;

  it("re-expresses euro rates as dollars per unit", () => {
    const { rateDate, rates } = parseEcbRates(feed);
    expect(rateDate).toBe("2026-09-15");

    const byCurrency = new Map(
      rates.map((rate) => [rate.currency, Number(rate.usdPerUnit)]),
    );
    expect(byCurrency.get("USD")).toBe(1);
    expect(byCurrency.get("EUR")).toBe(1.0842);
    // A pound buys more than a dollar; a yen buys far less.
    expect(byCurrency.get("GBP")).toBeCloseTo(1.0842 / 0.8461, 6);
    expect(byCurrency.get("JPY")).toBeCloseTo(1.0842 / 171.35, 6);
  });

  it("stores the day's rates, and re-importing overwrites only that day", async () => {
    const db = getDb();
    const first = await importFxRates(db, feed);
    expect(first).toEqual({ rateDate: "2026-09-15", stored: 4 });

    const corrected = feed.replace("1.0842", "1.0900");
    const second = await importFxRates(db, corrected);
    expect(second.stored).toBe(4);

    const [euro] = await db
      .select({ usdPerUnit: fxRates.usdPerUnit, source: fxRates.source })
      .from(fxRates)
      .where(eq(fxRates.currency, "EUR"));
    expect(Number(euro?.usdPerUnit)).toBe(1.09);
    expect(euro?.source).toBe("ecb");
  });

  it("refuses a feed it cannot read", () => {
    expect(() => parseEcbRates("<Envelope/>")).toThrow(/no date/);
    expect(() =>
      parseEcbRates(
        "<Cube time='2026-09-15'><Cube currency='GBP' rate='0.84'/>",
      ),
    ).toThrow(/dollar/);
  });
});
