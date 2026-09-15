import { randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";
import { describe, expect, it } from "vitest";
import { RateLimitedError } from "../lib/errors";
import { getRedis } from "../lib/redis";
import { testIp } from "../testing/auth";
import {
  accountKey,
  assertSignInAllowed,
  delayAfter,
  IP_ATTEMPTS,
  recordSignInFailure,
  recordSignInSuccess,
} from "./login-limits";

// SEC-08 sign-in limits, against the real Upstash client and the loopback redis-http store.

const redis = getRedis();
const email = () => `${randomUUID()}@limits.test`;
const T0 = 1_800_000_000_000;

async function refusal(attempt: Promise<unknown>): Promise<RateLimitedError> {
  const error = await attempt.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(RateLimitedError);
  return error as RateLimitedError;
}

describe("delayAfter", () => {
  it.each([
    [0, 0],
    [4, 0],
    [5, 1],
    [6, 2],
    [9, 16],
    [10, 30],
    [50, 30],
  ])("waits %i failures → %i s", (failures, seconds) => {
    expect(delayAfter(failures)).toBe(seconds);
  });
});

describe("per-IP limit", () => {
  it(`allows ${IP_ATTEMPTS} attempts in the window, then refuses that IP only`, async () => {
    const ip = testIp();
    for (let attempt = 0; attempt < IP_ATTEMPTS; attempt++) {
      await assertSignInAllowed(redis, { ip });
    }
    const error = await refusal(assertSignInAllowed(redis, { ip }));
    expect(error.retryAfterSeconds).toBeGreaterThan(0);
    expect(error.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);

    await expect(
      assertSignInAllowed(redis, { ip: testIp() }),
    ).resolves.toBeUndefined();
  });
});

describe("per-account delay", () => {
  it("adds a growing delay after 5 failures, from any IP", async () => {
    const address = email();
    for (let failure = 1; failure <= 4; failure++) {
      await recordSignInFailure(redis, address, T0);
    }
    await expect(
      assertSignInAllowed(redis, { ip: testIp(), email: address }, T0),
    ).resolves.toBeUndefined();

    await recordSignInFailure(redis, address, T0);
    expect(
      (
        await refusal(
          assertSignInAllowed(redis, { ip: testIp(), email: address }, T0),
        )
      ).retryAfterSeconds,
    ).toBe(1);
    await expect(
      assertSignInAllowed(redis, { ip: testIp(), email: address }, T0 + 1_000),
    ).resolves.toBeUndefined();

    await recordSignInFailure(redis, address, T0);
    expect(
      (
        await refusal(
          assertSignInAllowed(redis, { ip: testIp(), email: address }, T0),
        )
      ).retryAfterSeconds,
    ).toBe(2);
  });

  it("never locks an account: the delay is capped at 30 seconds", async () => {
    const address = email();
    for (let failure = 1; failure <= 40; failure++) {
      await recordSignInFailure(redis, address, T0);
    }
    expect(
      (
        await refusal(
          assertSignInAllowed(redis, { ip: testIp(), email: address }, T0),
        )
      ).retryAfterSeconds,
    ).toBe(30);
    await expect(
      assertSignInAllowed(redis, { ip: testIp(), email: address }, T0 + 30_000),
    ).resolves.toBeUndefined();
  });

  it("clears on a successful sign-in, and treats case and spacing as the same account", async () => {
    const address = email();
    for (let failure = 1; failure <= 8; failure++) {
      await recordSignInFailure(redis, `  ${address.toUpperCase()} `, T0);
    }
    await refusal(
      assertSignInAllowed(redis, { ip: testIp(), email: address }, T0),
    );

    await recordSignInSuccess(redis, address);
    await expect(
      assertSignInAllowed(redis, { ip: testIp(), email: address }, T0),
    ).resolves.toBeUndefined();
  });

  it("stores no email address in Redis", () => {
    const key = accountKey("Someone@Example.com");
    expect(key).not.toMatch(/@|someone|example/i);
    expect(key).toMatch(/:login:account:[0-9a-f]{64}$/);
  });
});

describe("store unavailable (fail closed)", () => {
  const unreachable = new Redis({
    url: "http://127.0.0.1:9",
    token: "unused",
    retry: false,
    enableTelemetry: false,
  });

  it("refuses sign-in instead of allowing unlimited attempts", async () => {
    await refusal(
      assertSignInAllowed(unreachable, { ip: testIp(), email: email() }),
    );
    await refusal(recordSignInFailure(unreachable, email()));
  });
});
