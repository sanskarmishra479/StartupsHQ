import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../db/client";
import { seed } from "../db/seed";
import { contexts } from "../testing/authz";
import { getCounts } from "./stats";

beforeAll(async () => {
  await seed(getDb());
});

afterAll(async () => {
  await closeDb();
});

describe("stats.getCounts", () => {
  it("counts only published records for public callers", async () => {
    for (const ctx of [contexts.anonymous, contexts.publicRead]) {
      expect(await getCounts(ctx)).toEqual({
        startups: 17,
        founders: 14,
        investors: 11,
        batches: 3,
        // The draft and archived Solstice Grid rounds and the archived startup's round are out.
        rounds: 25,
      });
    }
  });

  it("counts every record for an editor", async () => {
    expect(await getCounts(contexts.editor)).toEqual({
      startups: 19,
      founders: 16,
      investors: 13,
      batches: 5,
      rounds: 28,
    });
  });
});
