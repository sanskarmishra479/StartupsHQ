import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { getSessionStatus } from "../../../server/auth/session";
import { closeDb, getDb } from "../../../server/db/client";
import { users as usersTable } from "../../../server/db/schema";
import { seed } from "../../../server/db/seed";
import { WRITE_LIMIT_PER_MINUTE } from "../../../server/http/authed";
import type { RouteHandler } from "../../../server/http/handler";
import { outbox } from "../../../server/lib/email";
import {
  authPost,
  CookieJar,
  createTestUser,
  deleteTestUsers,
  headersWith,
  signInWithTwoFactor,
  TEST_PASSWORD,
} from "../../../server/testing/auth";
import * as contract from "../../../server/testing/contract";
import {
  fixtureId,
  startups as startupsTable,
} from "../../../server/testing/fixtures";
import * as batchList from "./batches/route";
import * as founderList from "./founders/route";
import * as investorList from "./investors/route";
import * as roundItem from "./rounds/[id]/route";
import * as roundList from "./rounds/route";
import * as startupPublish from "./startups/[slug]/publish/route";
import * as startupItem from "./startups/[slug]/route";
import * as startupList from "./startups/route";
import * as userDeactivate from "./users/[id]/deactivate/route";
import * as userReactivate from "./users/[id]/reactivate/route";
import * as userResetTwoFactor from "./users/[id]/reset-2fa/route";
import * as userItem from "./users/[id]/route";
import * as userInvite from "./users/invite/route";
import * as userList from "./users/route";

// Contract tests for the admin reads (docs/API.md §8.1) and staff accounts (§8.8, FR-208), plus
// the per-account write budget (SEC-08). Sessions are real Better Auth sessions with TOTP.

const ADMIN_ORIGIN = "https://admin.startupshq.test";
const PUBLIC_ORIGIN = "https://startupshq.test";

let editor: CookieJar;
let admin: CookieJar;
let adminId: string;

beforeAll(async () => {
  await seed(getDb());
  editor = await signInWithTwoFactor((await createTestUser("editor")).email);
  const adminUser = await createTestUser("admin");
  adminId = adminUser.id;
  admin = await signInWithTwoFactor(adminUser.email);
});

afterAll(async () => {
  await deleteTestUsers();
  await closeDb();
});

type SendOptions = Readonly<{
  jar?: CookieJar;
  body?: unknown;
  origin?: string | null;
  params?: Record<string, string>;
  /** Defaults to the admin origin, which is what makes a read an admin read. */
  base?: string;
}>;

function send(
  route: RouteHandler,
  method: string,
  path: string,
  options: SendOptions = {},
): Promise<Response> {
  const base = options.base ?? ADMIN_ORIGIN;
  const headers = new Headers({ host: new URL(base).host });
  const origin = options.origin === undefined ? ADMIN_ORIGIN : options.origin;
  if (origin !== null) headers.set("origin", origin);
  if (options.jar) headers.set("cookie", options.jar.header());
  const body =
    options.body === undefined ? undefined : JSON.stringify(options.body);
  if (body !== undefined) headers.set("content-type", "application/json");

  return route(
    new Request(`${base}/api/v1${path}`, { method, headers, body }),
    {
      params: Promise.resolve(options.params ?? {}),
    },
  );
}

async function read<S extends z.ZodType>(
  response: Promise<Response>,
  schema: S,
  status = 200,
): Promise<z.output<S>> {
  const resolved = await response;
  const text = await resolved.text();
  expect(resolved.status, text).toBe(status);
  const parsed = schema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
  return parsed.data;
}

async function expectError(
  response: Promise<Response>,
  status: number,
  code: string,
) {
  const body = await read(response, contract.errorBody, status);
  expect(body.error.code).toBe(code);
  return body.error;
}

const adminItem = z.object({
  id: z.uuid(),
  slug: z.string().nullable(),
  name: z.string().min(1),
  subtitle: z.string().nullable(),
  status: z.enum(["draft", "published", "archived"]),
  updatedAt: z.iso.datetime(),
  firstPublishedAt: z.iso.datetime().nullable(),
});
const adminList = contract.pageOf(adminItem);

const adminRecord = z.object({
  data: z.object({
    entity: z.enum(["startup", "founder", "investor", "batch", "round"]),
    id: z.uuid(),
    slug: z.string().nullable(),
    status: z.enum(["draft", "published", "archived"]),
    firstPublishedAt: z.iso.datetime().nullable(),
    archivedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    values: z.record(z.string(), z.unknown()),
    derived: z.record(z.string(), z.unknown()),
    links: z.record(z.string(), z.array(z.unknown())).optional(),
  }),
});

const adminUser = z.object({
  id: z.uuid(),
  email: z.string().min(3),
  name: z.string().min(1),
  role: z.enum(["admin", "editor"]),
  twoFactorEnabled: z.boolean(),
  deactivatedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

describe("admin lists (§8.1)", () => {
  it("includes drafts and archived records, unlike the public grid", async () => {
    const page = await read(
      send(startupList.GET, "GET", "/startups?limit=48", { jar: editor }),
      adminList,
    );
    const slugs = page.data.map((item) => item.slug);
    expect(slugs).toContain("stealth-draft-co");
    expect(slugs).toContain("sunset-legacy");

    const publicPage = await read(
      send(startupList.GET, "GET", "/startups?limit=48", {
        base: PUBLIC_ORIGIN,
      }),
      contract.pageOf(contract.startupCard),
    );
    expect(publicPage.data.map((card) => card.slug)).not.toContain(
      "stealth-draft-co",
    );
  });

  it("filters by status and searches by name", async () => {
    const drafts = await read(
      send(startupList.GET, "GET", "/startups?status=draft&limit=48", {
        jar: editor,
      }),
      adminList,
    );
    expect(drafts.data.length).toBeGreaterThan(0);
    expect(drafts.data.every((item) => item.status === "draft")).toBe(true);

    const found = await read(
      send(startupList.GET, "GET", "/startups?q=kiln", { jar: editor }),
      adminList,
    );
    expect(found.data.map((item) => item.slug)).toEqual(["kiln-analytics"]);

    // A search term is a literal, so wildcards cannot widen it.
    const wildcard = await read(
      send(startupList.GET, "GET", "/startups?q=%25", { jar: editor }),
      adminList,
    );
    expect(wildcard.data).toEqual([]);

    await expectError(
      send(startupList.GET, "GET", "/startups?status=hidden", { jar: editor }),
      400,
      "VALIDATION_ERROR",
    );
  });

  it("pages through every entity, naming rounds by their startup", async () => {
    for (const [route, path] of [
      [founderList.GET, "/founders"],
      [investorList.GET, "/investors"],
      [batchList.GET, "/batches"],
    ] as const) {
      const page = await read(
        send(route, "GET", `${path}?limit=5`, { jar: editor }),
        adminList,
      );
      expect(page.data.length).toBeGreaterThan(0);
      expect(page.pagination.limit).toBe(5);
    }

    const rounds = await read(
      send(roundList.GET, "GET", "/rounds?limit=48", { jar: editor }),
      adminList,
    );
    const named = rounds.data.find((item) => item.subtitle !== null);
    expect(named?.slug).toBeNull();
    expect(named?.subtitle).toEqual(expect.any(String));
  });

  it("is refused to anonymous and password-only callers", async () => {
    await expectError(
      send(startupList.GET, "GET", "/startups", {}),
      401,
      "UNAUTHORIZED",
    );
    await expectError(
      send(founderList.GET, "GET", "/founders", { base: PUBLIC_ORIGIN }),
      404,
      "NOT_FOUND",
    );
  });
});

describe("admin records (§8.1)", () => {
  it("returns the fields PATCH accepts, the derived ones and the links", async () => {
    const id = await fixtureId(startupsTable, "kiln-analytics");
    const { data } = await read(
      send(startupItem.GET, "GET", `/startups/${id}`, {
        jar: editor,
        params: { slug: id },
      }),
      adminRecord,
    );
    expect(data.entity).toBe("startup");
    expect(data.slug).toBe("kiln-analytics");
    expect(data.values.name).toBe("Kiln Analytics");
    expect(data.values).toHaveProperty("locationId");
    expect(data.values).not.toHaveProperty("status");
    expect(data.derived).toHaveProperty("totalRaisedUsd");
    expect(Array.isArray(data.links?.founders)).toBe(true);
    expect(Array.isArray(data.links?.rounds)).toBe(true);
  });

  it("opens a draft the public cannot see", async () => {
    const id = await fixtureId(startupsTable, "stealth-draft-co");
    const { data } = await read(
      send(startupItem.GET, "GET", `/startups/${id}`, {
        jar: editor,
        params: { slug: id },
      }),
      adminRecord,
    );
    expect(data.status).toBe("draft");
    await expectError(
      send(startupItem.GET, "GET", "/startups/stealth-draft-co", {
        base: PUBLIC_ORIGIN,
        params: { slug: "stealth-draft-co" },
      }),
      404,
      "NOT_FOUND",
    );
  });

  it("answers an unknown or malformed id with 404", async () => {
    for (const id of [randomUUID(), "kiln-analytics"]) {
      await expectError(
        send(startupItem.GET, "GET", `/startups/${id}`, {
          jar: editor,
          params: { slug: id },
        }),
        404,
        "NOT_FOUND",
      );
    }
  });

  it("serves a round, which has no public page", async () => {
    const list = await read(
      send(roundList.GET, "GET", "/rounds?limit=1", { jar: editor }),
      adminList,
    );
    const id = list.data[0]?.id ?? "";
    const { data } = await read(
      send(roundItem.GET, "GET", `/rounds/${id}`, {
        jar: editor,
        params: { id },
      }),
      adminRecord,
    );
    expect(data.entity).toBe("round");
    expect(data.slug).toBeNull();
    expect(data.derived).toHaveProperty("amountUsd");
  });
});

describe("staff accounts (§8.8, FR-208)", () => {
  const inviteFor = (email: string) =>
    outbox.filter((message) => message.to === email);

  it("is admin-only", async () => {
    await expectError(
      send(userList.GET, "GET", "/users", { jar: editor }),
      403,
      "FORBIDDEN",
    );
    await expectError(
      send(userInvite.POST, "POST", "/users/invite", {
        jar: editor,
        body: { email: "nobody@auth.test", role: "editor" },
      }),
      403,
      "FORBIDDEN",
    );
    const list = await read(
      send(userList.GET, "GET", "/users", { jar: admin }),
      contract.single(z.array(adminUser)),
    );
    expect(list.data.some((user) => user.id === adminId)).toBe(true);
  });

  it("invites an account that must set a password and then enrol two-factor", async () => {
    const email = `${randomUUID()}@auth.test`;
    const invited = await read(
      send(userInvite.POST, "POST", "/users/invite", {
        jar: admin,
        body: { email, role: "editor" },
      }),
      contract.single(adminUser),
      201,
    );
    expect(invited.data).toMatchObject({
      email,
      role: "editor",
      twoFactorEnabled: false,
      deactivatedAt: null,
    });

    const [message] = inviteFor(email);
    expect(message?.subject).toContain("invited");
    const url = message?.text.match(/https:\/\/\S+/)?.[0] ?? "";
    const token = url.split("/reset-password/")[1]?.split("?")[0] ?? "";
    expect(token.length).toBeGreaterThan(10);

    // The invitee sets their own password through the link.
    const newPassword = "a much better passphrase";
    const reset = await authPost("/reset-password", { token, newPassword });
    expect(reset.status, JSON.stringify(reset.body)).toBe(200);

    const jar = new CookieJar();
    const signedIn = await authPost(
      "/sign-in/email",
      { email, password: newPassword },
      { jar },
    );
    expect(signedIn.status).toBe(200);
    // A password alone is never an editor: two-factor enrolment comes first (FR-201).
    expect((await getSessionStatus(headersWith(jar))).kind).toBe(
      "enrollment-required",
    );

    // Re-inviting someone who never enrolled re-sends the link.
    await read(
      send(userInvite.POST, "POST", "/users/invite", {
        jar: admin,
        body: { email, role: "editor" },
      }),
      contract.single(adminUser),
      201,
    );
    expect(inviteFor(email).length).toBeGreaterThan(1);
  });

  it("refuses to invite an address already in use", async () => {
    const existing = await createTestUser("editor");
    await signInWithTwoFactor(existing.email);
    await expectError(
      send(userInvite.POST, "POST", "/users/invite", {
        jar: admin,
        body: { email: existing.email, role: "editor" },
      }),
      409,
      "CONFLICT",
    );
    await expectError(
      send(userInvite.POST, "POST", "/users/invite", {
        jar: admin,
        body: { email: "not-an-address", role: "editor" },
      }),
      400,
      "VALIDATION_ERROR",
    );
  });

  it("signs a user out everywhere when their role changes (SEC-04)", async () => {
    const user = await createTestUser("editor");
    const jar = await signInWithTwoFactor(user.email);
    expect((await getSessionStatus(headersWith(jar))).kind).toBe("authed");

    const changed = await read(
      send(userItem.PATCH, "PATCH", `/users/${user.id}`, {
        jar: admin,
        body: { role: "admin" },
        params: { id: user.id },
      }),
      contract.single(adminUser),
    );
    expect(changed.data.role).toBe("admin");
    expect((await getSessionStatus(headersWith(jar))).kind).toBe("anonymous");

    await expectError(
      send(userItem.PATCH, "PATCH", `/users/${adminId}`, {
        jar: admin,
        body: { role: "editor" },
        params: { id: adminId },
      }),
      422,
      "UNPROCESSABLE",
    );
  });

  it("resets two-factor, revoking sessions and telling the account holder", async () => {
    const user = await createTestUser("editor");
    const jar = await signInWithTwoFactor(user.email);

    const result = await read(
      send(userResetTwoFactor.POST, "POST", `/users/${user.id}/reset-2fa`, {
        jar: admin,
        params: { id: user.id },
      }),
      contract.single(adminUser),
    );
    expect(result.data.twoFactorEnabled).toBe(false);
    expect((await getSessionStatus(headersWith(jar))).kind).toBe("anonymous");
    expect(outbox.some((message) => message.to === user.email)).toBe(true);
  });

  it("deactivates an account, refusing sign-in exactly as a wrong password does", async () => {
    const user = await createTestUser("editor");
    const jar = await signInWithTwoFactor(user.email);

    const deactivated = await read(
      send(userDeactivate.POST, "POST", `/users/${user.id}/deactivate`, {
        jar: admin,
        params: { id: user.id },
      }),
      contract.single(adminUser),
    );
    expect(deactivated.data.deactivatedAt).not.toBeNull();
    expect((await getSessionStatus(headersWith(jar))).kind).toBe("anonymous");

    const refused = await authPost("/sign-in/email", {
      email: user.email,
      password: TEST_PASSWORD,
    });
    const wrongPassword = await authPost("/sign-in/email", {
      email: user.email,
      password: "not the password at all",
    });
    expect(refused.status).toBe(wrongPassword.status);
    expect(refused.body).toEqual(wrongPassword.body);

    await expectError(
      send(userDeactivate.POST, "POST", `/users/${adminId}/deactivate`, {
        jar: admin,
        params: { id: adminId },
      }),
      422,
      "UNPROCESSABLE",
    );

    const restored = await read(
      send(userReactivate.POST, "POST", `/users/${user.id}/reactivate`, {
        jar: admin,
        params: { id: user.id },
      }),
      contract.single(adminUser),
    );
    expect(restored.data.deactivatedAt).toBeNull();
    const [row] = await getDb()
      .select({ deactivatedAt: usersTable.deactivatedAt })
      .from(usersTable)
      .where(eq(usersTable.id, user.id));
    expect(row?.deactivatedAt).toBeNull();
  });
});

describe("the write budget (SEC-08)", () => {
  it("refuses writes past the per-account limit, with Retry-After", async () => {
    const jar = await signInWithTwoFactor((await createTestUser()).email);
    const id = randomUUID();
    let limited: Response | undefined;

    for (let attempt = 0; attempt <= WRITE_LIMIT_PER_MINUTE; attempt += 1) {
      const response = await send(
        startupPublish.POST,
        "POST",
        `/startups/${id}/publish`,
        { jar, params: { slug: id } },
      );
      if (response.status === 429) {
        limited = response;
        break;
      }
      // Until the budget runs out, the write is refused only because the record is missing.
      expect(response.status).toBe(404);
    }

    expect(limited?.status).toBe(429);
    expect(Number(limited?.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await limited?.json())?.error.code).toBe("RATE_LIMITED");
  });
});
