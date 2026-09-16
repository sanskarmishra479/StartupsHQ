import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as broken from "./__fixtures__/broken-service";
import * as stub from "./__fixtures__/stub-service";
import {
  type AuthzRegistry,
  authzViolations,
  collectExportedFunctions,
  contexts,
  defineAuthzSuite,
  registryGaps,
} from "./authz";

// Compile-time half of the cached-read contract (ADR-013): a function taking PublicReadContext
// must refuse request contexts in `tsc`, before the runtime guard is ever reached. If one of
// these lines stops being an error, `@ts-expect-error` itself fails the typecheck.
function _cachedReadsRejectRequestContexts() {
  // @ts-expect-error a public request context is not PUBLIC_READ
  stub.getCachedThings(contexts.anonymous);
  // @ts-expect-error an authenticated context must never enter a shared cache entry
  stub.getCachedThings(contexts.editor);
  stub.getCachedThings(contexts.publicRead);
}
void _cachedReadsRejectRequestContexts;

// The harness itself is proven here: green on a conforming stub, and loud on a broken one.

const fixturesDir = join(import.meta.dirname, "__fixtures__");

const hasDraft = (result: unknown) =>
  Array.isArray(result) &&
  result.some((item) => (item as { status?: unknown }).status === "draft");

const stubRegistry: AuthzRegistry = {
  "stub-service.ts#listThings": {
    kind: "read",
    invoke: (ctx) => stub.listThings(ctx),
    seesDraft: hasDraft,
  },
  "stub-service.ts#listThingsForEditors": {
    kind: "editor-read",
    invoke: (ctx) => stub.listThingsForEditors(ctx),
    seesDraft: hasDraft,
  },
  "stub-service.ts#getCachedThings": {
    kind: "cached-read",
    invoke: (ctx) => stub.getCachedThings(ctx),
    seesDraft: hasDraft,
  },
  "stub-service.ts#renameThing": {
    kind: "mutation",
    invoke: (ctx) => stub.renameThing(ctx, "renamed"),
  },
  "stub-service.ts#purgeThing": {
    kind: "admin-mutation",
    invoke: (ctx) => stub.purgeThing(ctx),
  },
};

const stubExports = (await collectExportedFunctions(fixturesDir)).filter(
  (key) => key.startsWith("stub-service.ts#"),
);

defineAuthzSuite(
  "authz harness on a conforming stub service",
  stubRegistry,
  stubExports,
);

describe("authz harness catches broken services", () => {
  it("flags a read that leaks drafts", async () => {
    expect(
      await authzViolations({
        kind: "read",
        invoke: broken.leakyList,
        seesDraft: hasDraft,
      }),
    ).toEqual([
      "anonymous saw a draft",
      "publicRead saw a draft",
      "forgedAdmin saw a draft",
    ]);
  });

  it("flags a mutation without assertEditor", async () => {
    expect(
      await authzViolations({
        kind: "mutation",
        invoke: broken.unguardedDelete,
      }),
    ).toEqual([
      "anonymous was not refused",
      "publicRead was not refused",
      "forgedAdmin was not refused",
    ]);
  });

  it("flags an admin-panel read that anyone can call", async () => {
    expect(
      await authzViolations({
        kind: "editor-read",
        invoke: broken.unguardedEditorList,
        seesDraft: hasDraft,
      }),
    ).toEqual([
      "anonymous was not refused",
      "publicRead was not refused",
      "forgedAdmin was not refused",
    ]);
  });

  it("flags an admin action that only checks for an editor", async () => {
    expect(
      await authzViolations({
        kind: "admin-mutation",
        invoke: broken.editorOnlyPurge,
      }),
    ).toEqual(["editor was not refused"]);
  });

  it("flags a cached read without its runtime guard", async () => {
    expect(
      await authzViolations({
        kind: "cached-read",
        invoke: broken.cachedReadWithoutGuard,
        seesDraft: hasDraft,
      }),
    ).toEqual([
      "anonymous was accepted by a cached read",
      "editor was accepted by a cached read",
      "forgedAdmin was accepted by a cached read",
    ]);
  });

  it("flags unregistered functions and stale registry entries", () => {
    const entry = { kind: "mutation", invoke: () => undefined } as const;
    expect(
      registryGaps(["a.ts#kept", "a.ts#added"], {
        "a.ts#kept": entry,
        "a.ts#removed": entry,
      }),
    ).toEqual({ unregistered: ["a.ts#added"], stale: ["a.ts#removed"] });
  });

  it("discovers exported functions, and ignores test files", async () => {
    const keys = await collectExportedFunctions(fixturesDir);
    expect(keys).toEqual(
      expect.arrayContaining([
        "broken-service.ts#leakyList",
        "stub-service.ts#listThings",
      ]),
    );
    expect(keys.some((key) => key.includes(".test."))).toBe(false);
  });
});
