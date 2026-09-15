import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../db/client";
import { users } from "../db/schema";
import { ForbiddenError, UnauthorizedError } from "../lib/errors";
import {
  authPost,
  CookieJar,
  createTestUser,
  deleteTestUsers,
  headersWith,
  TEST_PASSWORD,
  testIp,
  totp,
} from "../testing/auth";
import { getAuth } from "./better-auth";
import {
  getSessionContext,
  getSessionStatus,
  requireAdmin,
  requireEditor,
} from "./session";

// docs/TEST_PLAN.md: Phase 6 authentication, through the real Better Auth handler (FR-201,
// SEC-04, SEC-08).

const SESSION_COOKIE = "__Host-startupshq.session_token";
const previousVercel = process.env.VERCEL;

beforeAll(() => {
  // Trust x-real-ip as Vercel would, so each request can come from its own test IP (SEC-14).
  process.env.VERCEL = "1";
});

afterAll(async () => {
  if (previousVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = previousVercel;
  await deleteTestUsers();
  await closeDb();
});

const signIn = (email: string, jar: CookieJar, password = TEST_PASSWORD) =>
  authPost("/sign-in/email", { email, password }, { jar });

/** Signs in with a password and enrols TOTP, as the first sign-in must. */
async function enrol(email: string) {
  const jar = new CookieJar();
  expect((await signIn(email, jar)).status).toBe(200);
  const enabled = await authPost(
    "/two-factor/enable",
    { password: TEST_PASSWORD },
    { jar },
  );
  expect(enabled.status).toBe(200);
  const secret =
    new URL(String(enabled.body?.totpURI)).searchParams.get("secret") ?? "";
  const verified = await authPost(
    "/two-factor/verify-totp",
    { code: totp(secret) },
    { jar },
  );
  expect(verified.status).toBe(200);
  return {
    jar,
    secret,
    backupCodes: enabled.body?.backupCodes as string[],
  };
}

describe("session cookie (SEC-04 cookie-prefix spike)", () => {
  it("is __Host- prefixed, Secure, HttpOnly, SameSite=Lax, Path=/ and host-only", async () => {
    const { email } = await createTestUser();
    const response = await signIn(email, new CookieJar());

    const cookie = response.setCookies.find((header) =>
      header.startsWith(`${SESSION_COOKIE}=`),
    );
    expect(cookie).toBeDefined();
    const attributes = (cookie ?? "")
      .split(";")
      .map((part) => part.trim().toLowerCase());
    expect(attributes).toEqual(
      expect.arrayContaining(["secure", "httponly", "samesite=lax", "path=/"]),
    );
    expect(
      attributes.some((attribute) => attribute.startsWith("domain=")),
    ).toBe(false);
  });
});

describe("mandatory two-factor (FR-201)", () => {
  it("never lets a password alone authorize a write", async () => {
    const { email } = await createTestUser();
    const jar = new CookieJar();
    expect((await signIn(email, jar)).status).toBe(200);

    const status = await getSessionStatus(headersWith(jar));
    expect(status.kind).toBe("enrollment-required");
    expect((await getSessionContext(headersWith(jar))).kind).toBe("public");
    await expect(requireEditor(headersWith(jar))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it("gives 10 recovery codes on enrolment, then an editor session", async () => {
    const { id, email } = await createTestUser();
    const { jar, backupCodes } = await enrol(email);

    expect(backupCodes).toHaveLength(10);
    expect(new Set(backupCodes).size).toBe(10);
    const ctx = await requireEditor(headersWith(jar));
    expect(ctx.actor).toEqual({ id, role: "editor" });
    // An editor is refused admin-only actions.
    await expect(requireAdmin(headersWith(jar))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("after enrolment, a password only starts the second-factor challenge", async () => {
    const { email } = await createTestUser();
    const { secret } = await enrol(email);

    const jar = new CookieJar();
    const response = await signIn(email, jar);
    expect(response.body).toMatchObject({ twoFactorRedirect: true });
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect((await getSessionStatus(headersWith(jar))).kind).toBe("anonymous");

    // The next time step, as an authenticator app would show it after the enrolment code.
    const verified = await authPost(
      "/two-factor/verify-totp",
      { code: totp(secret, Date.now() + 30_000) },
      { jar },
    );
    expect(verified.status).toBe(200);
    expect((await getSessionStatus(headersWith(jar))).kind).toBe("authed");
  });

  it("accepts each recovery code once", async () => {
    const { email } = await createTestUser();
    const { backupCodes } = await enrol(email);
    const [code] = backupCodes;

    const first = new CookieJar();
    await signIn(email, first);
    expect(
      (
        await authPost(
          "/two-factor/verify-backup-code",
          { code },
          { jar: first },
        )
      ).status,
    ).toBe(200);
    expect((await getSessionStatus(headersWith(first))).kind).toBe("authed");

    const second = new CookieJar();
    await signIn(email, second);
    const reused = await authPost(
      "/two-factor/verify-backup-code",
      { code },
      { jar: second },
    );
    expect(reused.status).not.toBe(200);
    expect((await getSessionStatus(headersWith(second))).kind).toBe(
      "anonymous",
    );
  });
});

describe("sessions and accounts", () => {
  it("rejects a revoked session", async () => {
    const { id, email } = await createTestUser();
    const { jar } = await enrol(email);
    expect((await getSessionStatus(headersWith(jar))).kind).toBe("authed");

    const ctx = await getAuth().$context;
    await ctx.internalAdapter.deleteUserSessions(id);
    expect((await getSessionStatus(headersWith(jar))).kind).toBe("anonymous");
  });

  it("gives an admin an admin context", async () => {
    const { id, email } = await createTestUser("admin");
    const { jar } = await enrol(email);
    expect((await requireAdmin(headersWith(jar))).actor).toEqual({
      id,
      role: "admin",
    });
  });

  it("keeps sign-up closed", async () => {
    const email = `closed-${Date.now()}@auth.test`;
    const response = await authPost("/sign-up/email", {
      email,
      password: TEST_PASSWORD,
      name: "Nobody",
    });
    expect(response.status).not.toBe(200);
    expect(
      await getDb()
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email)),
    ).toEqual([]);
  });

  it("answers a wrong password and an unknown email the same way", async () => {
    const { email } = await createTestUser();
    const wrong = await signIn(
      email,
      new CookieJar(),
      "not the password at all",
    );
    const unknown = await signIn("nobody-here@auth.test", new CookieJar());
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body?.message).toBe(unknown.body?.message);
  });
});

describe("sign-in limits through the handler (SEC-08)", () => {
  it("delays an account after 5 failures, even with the right password from a new IP", async () => {
    const { email } = await createTestUser();
    for (let failure = 1; failure <= 5; failure++) {
      const response = await authPost(
        "/sign-in/email",
        { email, password: "wrong password each time" },
        { ip: testIp() },
      );
      expect(response.status).toBe(401);
    }

    const refused = await authPost(
      "/sign-in/email",
      { email, password: TEST_PASSWORD },
      { ip: testIp() },
    );
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});
