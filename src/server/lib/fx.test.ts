import { afterAll, describe, expect, it } from "vitest";
import { closeDb, getDb, type Transaction } from "../db/client";
import { fxRates } from "../db/schema";
import { UnprocessableError } from "./errors";
import { convertRound, convertToWholeUsd, findRate } from "./fx";

const ROLLBACK = new Error("rollback");

/** Runs fn with XTS rates (ISO 4217's code reserved for testing), then rolls everything back. */
async function withTestRates(fn: (tx: Transaction) => Promise<void>) {
  await getDb()
    .transaction(async (tx) => {
      await tx.insert(fxRates).values([
        {
          currency: "XTS",
          rateDate: "2026-02-26",
          usdPerUnit: "1.10000000",
          source: "ecb",
        },
        {
          currency: "XTS",
          rateDate: "2026-02-27",
          usdPerUnit: "1.20000000",
          source: "ecb",
        },
        // 2026-02-28 and 2026-03-01 are a weekend.
        {
          currency: "XTS",
          rateDate: "2026-03-02",
          usdPerUnit: "1.30000000",
          source: "ecb",
        },
      ]);
      await fn(tx);
      throw ROLLBACK;
    })
    .catch((error: unknown) => {
      if (error !== ROLLBACK) throw error;
    });
}

afterAll(async () => {
  await closeDb();
});

describe("convertToWholeUsd", () => {
  it.each([
    ["4500000.00", "1.08420000", 4_878_900],
    ["1500000000.00", "0.00061000", 915_000],
    ["0.29", "100", 29], // 0.29 * 100 in floating point is 28.999999999999996
    ["2.50", "1", 3],
    ["2.49", "1", 2],
    ["10.005", "1", 10],
    ["0.50", "1", 1],
    [String(Number.MAX_SAFE_INTEGER), "1", Number.MAX_SAFE_INTEGER],
  ])("%s × %s → %d", (amount, rate, expected) => {
    expect(convertToWholeUsd(amount, rate)).toBe(expected);
  });

  it("refuses amounts that cannot be stored exactly", () => {
    expect(() =>
      convertToWholeUsd(String(Number.MAX_SAFE_INTEGER + 1), "1"),
    ).toThrow(UnprocessableError);
  });

  it("rejects malformed decimals", () => {
    for (const bad of ["-1", "1e6", "", "1.2.3", " 5"]) {
      expect(() => convertToWholeUsd(bad, "1")).toThrow();
    }
  });
});

describe("findRate", () => {
  it("uses the rate on the announcement date", async () => {
    await withTestRates(async (tx) => {
      expect((await findRate(tx, "XTS", "2026-03-02"))?.usdPerUnit).toBe(
        "1.30000000",
      );
    });
  });

  it("falls back to the latest prior business day", async () => {
    await withTestRates(async (tx) => {
      const rate = await findRate(tx, "XTS", "2026-03-01"); // a Sunday
      expect(rate).toMatchObject({
        rateDate: "2026-02-27",
        usdPerUnit: "1.20000000",
      });
    });
  });

  it("refuses a rate older than seven days", async () => {
    await withTestRates(async (tx) => {
      expect(await findRate(tx, "XTS", "2026-03-20")).toBeNull();
    });
  });

  it("never uses a rate from after the announcement", async () => {
    await withTestRates(async (tx) => {
      expect(await findRate(tx, "XTS", "2026-02-25")).toBeNull();
    });
  });

  it("returns null for a currency with no rates", async () => {
    await withTestRates(async (tx) => {
      expect(await findRate(tx, "XXX", "2026-03-02")).toBeNull();
    });
  });
});

describe("convertRound", () => {
  it("stores USD amounts without FX details", async () => {
    expect(
      await convertRound(getDb(), {
        currency: "USD",
        amountOriginal: "2500000.00",
        announcedOn: "2026-03-02",
      }),
    ).toEqual({
      amountUsd: 2_500_000,
      fxRate: null,
      fxRateDate: null,
      fxSource: null,
    });
  });

  it("converts at the applicable rate and records it", async () => {
    await withTestRates(async (tx) => {
      expect(
        await convertRound(tx, {
          currency: "XTS",
          amountOriginal: "1000000.00",
          announcedOn: "2026-03-01",
        }),
      ).toEqual({
        amountUsd: 1_200_000,
        fxRate: "1.20000000",
        fxRateDate: "2026-02-27",
        fxSource: "ecb",
      });
    });
  });

  it("asks for a manual rate when none applies", async () => {
    await withTestRates(async (tx) => {
      await expect(
        convertRound(tx, {
          currency: "XTS",
          amountOriginal: "1000.00",
          announcedOn: "2026-04-30",
        }),
      ).rejects.toThrow(UnprocessableError);
    });
  });
});
