import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../db/client";
import {
  auditLog,
  erasureLog,
  founders as foundersTable,
  mediaAssets,
  startupFounders,
  startups as startupsTable,
} from "../db/schema";
import { seed } from "../db/seed";
import {
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
  ValidationError,
} from "../lib/errors";
import { contexts } from "../testing/authz";
import { fixtureId, found } from "../testing/fixtures";
import { cacheCalls, resetCacheCalls } from "../testing/next-cache";
import { ensureTestUsers } from "../testing/users";
import * as founderWrites from "./founder-writes";
import * as founderReads from "./founders";
import {
  eraseFounder,
  listRequests,
  recordRequest,
  resolveRequest,
} from "./privacy";
import { addFounder } from "./relation-writes";
import * as startupReads from "./startups";

// docs/TEST_PLAN.md §6: privacy.eraseFounder, plus privacy requests. FR-210, FR-410, SEC-18.

const { anonymous, editor, admin } = contexts;
const NIL = "00000000-0000-4000-8000-000000000000";

beforeAll(async () => {
  await ensureTestUsers();
  await seed(getDb());
});

beforeEach(() => {
  resetCacheCalls();
});

afterAll(async () => {
  await seed(getDb());
  await closeDb();
});

const expired = () =>
  cacheCalls
    .filter((call) => call.fn === "revalidateTag")
    .map((call) => call.args[0]);

/** Runs as the app role and rolls back, returning what the callback produced. */
async function asAppRole<T>(
  work: (
    tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  ) => Promise<T>,
): Promise<T> {
  const rollback = Symbol("rollback");
  let result: T | undefined;
  await getDb()
    .transaction(async (tx) => {
      await tx.execute(sql`set local role startupshq_app`);
      result = await work(tx);
      throw rollback;
    })
    .catch((error: unknown) => {
      if (error !== rollback) throw error;
    });
  return result as T;
}

describe("privacy requests (FR-210)", () => {
  it("records a request with a 30-day deadline, notes audited by name only", async () => {
    await expect(
      recordRequest(editor, {
        requestType: "access",
        subjectEntityType: "other",
        receivedAt: "2026-09-01T09:00:00Z",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const request = await recordRequest(admin, {
      requestType: "erasure",
      subjectEntityType: "founder",
      subjectEntityId: await fixtureId(foundersTable, "ruby-walsh"),
      receivedAt: "2026-09-01T09:00:00Z",
      notes: "Requested by ruby@example.com",
    });

    expect(request).toMatchObject({
      status: "open",
      receivedAt: "2026-09-01T09:00:00.000Z",
      dueAt: "2026-10-01T09:00:00.000Z",
      resolvedAt: null,
    });
    const [audit] = await getDb()
      .select({ diff: auditLog.diff })
      .from(auditLog)
      .where(eq(auditLog.entityId, request.id));
    expect(audit?.diff).toMatchObject({ notes: { changed: true } });
    expect(JSON.stringify(audit?.diff)).not.toContain("ruby@example.com");

    expect(
      (await listRequests(admin, { status: "open" })).map((r) => r.id),
    ).toContain(request.id);
  });

  it("resolves a request once", async () => {
    const request = await recordRequest(admin, {
      requestType: "correction",
      subjectEntityType: "other",
      receivedAt: "2026-09-02T09:00:00Z",
    });

    const resolved = await resolveRequest(admin, request.id, {
      status: "completed",
    });
    expect(resolved.status).toBe("completed");
    expect(resolved.resolvedAt).not.toBeNull();
    await expect(
      resolveRequest(admin, request.id, { status: "rejected" }),
    ).rejects.toBeInstanceOf(UnprocessableError);
  });

  it.each<
    [string, () => Promise<unknown>, abstract new (...args: never[]) => Error]
  >([
    [
      "a request received in the future",
      () =>
        recordRequest(admin, {
          requestType: "access",
          subjectEntityType: "other",
          receivedAt: "2999-01-01T00:00:00Z",
        }),
      UnprocessableError,
    ],
    [
      "an unknown request type",
      () =>
        recordRequest(admin, {
          requestType: "deletion" as never,
          subjectEntityType: "other",
          receivedAt: "2026-09-01T00:00:00Z",
        }),
      ValidationError,
    ],
    [
      "a missing request",
      () => resolveRequest(admin, NIL, { status: "completed" }),
      NotFoundError,
    ],
    ["listing as an editor", () => listRequests(editor), ForbiddenError],
  ])("refuses %s", async (_label, attempt, errorType) => {
    await expect(attempt()).rejects.toBeInstanceOf(errorType);
  });
});

describe("founder erasure (FR-410)", () => {
  it("requires an admin and the exact typed confirmation", async () => {
    const id = await fixtureId(foundersTable, "mira-okafor");

    await expect(
      eraseFounder(editor, id, { confirm: "ERASE mira-okafor" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    for (const confirm of [
      "erase mira-okafor",
      "ERASE mira",
      "ERASE ruby-walsh",
    ]) {
      await expect(eraseFounder(admin, id, { confirm })).rejects.toBeInstanceOf(
        UnprocessableError,
      );
    }
    // Nothing happened.
    expect(await fixtureId(foundersTable, "mira-okafor")).toBe(id);
    expect(expired()).toEqual([]);
  });

  it("removes the founder, their links and photo, and every personal trace in the audit log", async () => {
    const id = await fixtureId(foundersTable, "mira-okafor");
    const kilnId = await fixtureId(startupsTable, "kiln-analytics");

    // Leave personal traces: a profile edit, a new stint, a photo, and a privacy request.
    const [photo] = await getDb()
      .insert(mediaAssets)
      .values({ blobPrefix: "tests/mira-photo", purpose: "photo" })
      .returning({ id: mediaAssets.id });
    await founderWrites.update(editor, id, {
      headline: "Serial founder",
      photoAssetId: photo?.id,
    });
    await addFounder(editor, kilnId, {
      founderId: id,
      role: "advisor",
      joinedYear: 2026,
    });
    const request = await recordRequest(admin, {
      requestType: "erasure",
      subjectEntityType: "founder",
      subjectEntityId: id,
      receivedAt: "2026-09-03T09:00:00Z",
    });
    resetCacheCalls();

    const { scrubbedAuditRows } = await eraseFounder(admin, id, {
      confirm: "ERASE mira-okafor",
    });

    // The founder and every stint are gone, publicly and in the database.
    await expect(
      founderReads.getBySlug(anonymous, "mira-okafor"),
    ).rejects.toBeInstanceOf(NotFoundError);
    const kiln = await found(
      startupReads.getBySlug(anonymous, "kiln-analytics"),
    );
    expect(kiln.founders.map((founder) => founder.slug)).not.toContain(
      "mira-okafor",
    );
    expect(
      await getDb()
        .select({ id: startupFounders.id })
        .from(startupFounders)
        .where(eq(startupFounders.founderId, id)),
    ).toEqual([]);

    // Audit rows about her, or mentioning her id, are redacted; none still point at her.
    expect(scrubbedAuditRows).toBeGreaterThanOrEqual(2);
    const traces = await getDb()
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        sql`${auditLog.entityId} = ${id}::uuid or strpos(${auditLog.diff}::text, ${id}) > 0`,
      );
    expect(traces).toEqual([]);
    const redacted = await getDb()
      .select({ diff: auditLog.diff, ip: auditLog.ip })
      .from(auditLog)
      .where(sql`${auditLog.diff} = '{"scrubbed": true}'::jsonb`);
    expect(redacted.length).toBe(scrubbedAuditRows);
    expect(redacted.every((row) => row.ip === null)).toBe(true);

    // Proof of the erasure keeps only a hash.
    // erasure_log is not reset by the seed, so look for this erasure's hash specifically.
    const hash = createHash("sha256").update(id).digest("hex");
    const proofs = await getDb()
      .select({ hash: erasureLog.entityIdHash, actorId: erasureLog.actorId })
      .from(erasureLog)
      .where(eq(erasureLog.entityIdHash, hash));
    expect(proofs).toEqual([{ hash, actorId: admin.actor.id }]);
    const [erase] = await getDb()
      .select({ entityId: auditLog.entityId, diff: auditLog.diff })
      .from(auditLog)
      .where(
        and(eq(auditLog.action, "erase"), eq(auditLog.entityType, "founder")),
      );
    expect(erase).toEqual({ entityId: null, diff: {} });

    // Her photo is queued for deletion, the request no longer names her, and pages expire.
    const [asset] = await getDb()
      .select({ state: mediaAssets.state })
      .from(mediaAssets)
      .where(eq(mediaAssets.id, photo?.id ?? NIL));
    expect(asset?.state).toBe("staging");
    expect(
      (await listRequests(admin)).find((r) => r.id === request.id)
        ?.subjectEntityId,
    ).toBeNull();
    expect(expired()).toEqual(
      expect.arrayContaining([
        "founder:mira-okafor",
        "startup:kiln-analytics",
        "startup:lanternfish-ai",
        "startup:tidewater-labs",
      ]),
    );
  });

  it("is NotFound for a founder that does not exist", async () => {
    await expect(
      eraseFounder(admin, NIL, { confirm: "ERASE nobody" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("the audit scrub function (migration 0004)", () => {
  it("is callable by the app role, but only once the founder is gone", async () => {
    const living = await fixtureId(foundersTable, "ruby-walsh");
    await expect(
      asAppRole((tx) =>
        tx.execute(sql`select public.scrub_founder_audit(${living}::uuid)`),
      ),
    ).rejects.toMatchObject({
      cause: { message: expect.stringContaining("still exists") },
    });

    const { rows } = await asAppRole((tx) =>
      tx.execute<{ scrubbed: number }>(
        sql`select public.scrub_founder_audit(${NIL}::uuid) as scrubbed`,
      ),
    );
    expect(rows[0]?.scrubbed).toBe(0);
  });

  it("is the only way the app role can rewrite the audit log", async () => {
    await expect(
      asAppRole((tx) =>
        tx.execute(sql`update public.audit_log set diff = '{}'::jsonb`),
      ),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
  });
});
