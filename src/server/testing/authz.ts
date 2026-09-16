import "server-only";

import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  authedContext,
  PUBLIC_READ,
  type PublicReadContext,
  publicContext,
  type ReadContext,
} from "../auth/context";
import { ForbiddenError } from "../lib/errors";

// The authz conformance harness (docs/TEST_PLAN.md §7, SEC-03, NFR-10).
//
// Every exported function in src/server/services and src/server/cache is registered with its
// kind, and each kind has a contract:
//   read            public, public-read and forged contexts never see a draft; an editor does
//   editor-read     public, public-read and forged contexts are refused; editors do see drafts
//   cached-read     PUBLIC_READ works and hides drafts; every other context throws
//   mutation        public, public-read and forged contexts are refused; editors and admins are not
//   admin-mutation  as mutation, and editors are refused too
// Unregistered or stale entries fail, so a new function cannot silently skip the checks.

export type AuthzEntry =
  | {
      kind: "read";
      invoke: (ctx: ReadContext) => unknown;
      seesDraft: (result: unknown) => boolean;
    }
  | {
      kind: "cached-read";
      invoke: (ctx: PublicReadContext) => unknown;
      seesDraft: (result: unknown) => boolean;
    }
  | {
      /** An admin-panel read: refuses public callers outright and shows drafts to editors. */
      kind: "editor-read";
      invoke: (ctx: ReadContext) => unknown;
      seesDraft: (result: unknown) => boolean;
    }
  | { kind: "mutation"; invoke: (ctx: ReadContext) => unknown }
  | { kind: "admin-mutation"; invoke: (ctx: ReadContext) => unknown };

export type AuthzRegistry = Readonly<Record<string, AuthzEntry>>;

export const contexts = {
  anonymous: publicContext("203.0.113.50"),
  publicRead: PUBLIC_READ,
  editor: authedContext(
    { id: "00000000-0000-4000-8000-0000000000e1", role: "editor" },
    "203.0.113.51",
  ),
  admin: authedContext(
    { id: "00000000-0000-4000-8000-0000000000a1", role: "admin" },
    "203.0.113.52",
  ),
  /** Shaped exactly like an admin context, but not built by authedContext(). */
  forgedAdmin: {
    kind: "authed",
    actor: { id: "attacker", role: "admin" },
    ip: "198.51.100.66",
  } as unknown as ReadContext,
} as const;

type ContextName = keyof typeof contexts;

/** Every exported function in non-test modules under `dir`, keyed "relative/path.ts#name". */
export async function collectExportedFunctions(
  dir: string,
  root: string = dir,
): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const keys: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__fixtures__") {
        keys.push(...(await collectExportedFunctions(full, root)));
      }
      continue;
    }
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) {
      continue;
    }
    const module = (await import(full)) as Record<string, unknown>;
    for (const [name, value] of Object.entries(module)) {
      if (typeof value === "function") {
        keys.push(`${relative(root, full)}#${name}`);
      }
    }
  }
  return keys.sort();
}

export function registryGaps(
  exported: readonly string[],
  registry: AuthzRegistry,
): { unregistered: string[]; stale: string[] } {
  const registered = new Set(Object.keys(registry));
  const found = new Set(exported);
  return {
    unregistered: exported.filter((key) => !registered.has(key)),
    stale: [...registered].filter((key) => !found.has(key)).sort(),
  };
}

type Outcome = { ok: true; value: unknown } | { ok: false; error: unknown };

async function attempt(run: () => unknown): Promise<Outcome> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error };
  }
}

const isForbidden = (outcome: Outcome) =>
  !outcome.ok && outcome.error instanceof ForbiddenError;

/** Everything an entry gets wrong. An empty list means it conforms. */
export async function authzViolations(entry: AuthzEntry): Promise<string[]> {
  const violations: string[] = [];

  const mustRefuse = async (names: readonly ContextName[]) => {
    if (entry.kind === "read" || entry.kind === "cached-read") return;
    for (const name of names) {
      if (!isForbidden(await attempt(() => entry.invoke(contexts[name])))) {
        violations.push(`${name} was not refused`);
      }
    }
  };
  const mustAdmit = async (names: readonly ContextName[]) => {
    if (entry.kind === "read" || entry.kind === "cached-read") return;
    for (const name of names) {
      if (isForbidden(await attempt(() => entry.invoke(contexts[name])))) {
        violations.push(`${name} was refused`);
      }
    }
  };

  switch (entry.kind) {
    case "mutation":
      await mustRefuse(["anonymous", "publicRead", "forgedAdmin"]);
      await mustAdmit(["editor", "admin"]);
      break;

    case "admin-mutation":
      await mustRefuse(["anonymous", "publicRead", "forgedAdmin", "editor"]);
      await mustAdmit(["admin"]);
      break;

    case "editor-read": {
      await mustRefuse(["anonymous", "publicRead", "forgedAdmin"]);
      for (const name of ["editor", "admin"] as const) {
        const outcome = await attempt(() => entry.invoke(contexts[name]));
        if (!outcome.ok) violations.push(`${name} read failed`);
        else if (!entry.seesDraft(outcome.value)) {
          violations.push(`${name} could not see drafts`);
        }
      }
      break;
    }

    case "read": {
      for (const name of ["anonymous", "publicRead", "forgedAdmin"] as const) {
        const outcome = await attempt(() => entry.invoke(contexts[name]));
        if (!outcome.ok) violations.push(`${name} read failed`);
        else if (entry.seesDraft(outcome.value)) {
          violations.push(`${name} saw a draft`);
        }
      }
      const editor = await attempt(() => entry.invoke(contexts.editor));
      if (!editor.ok || !entry.seesDraft(editor.value)) {
        violations.push("editor could not see drafts");
      }
      break;
    }

    case "cached-read": {
      const outcome = await attempt(() => entry.invoke(contexts.publicRead));
      if (!outcome.ok) violations.push("publicRead read failed");
      else if (entry.seesDraft(outcome.value)) {
        violations.push("publicRead saw a draft");
      }
      for (const name of ["anonymous", "editor", "forgedAdmin"] as const) {
        const wrongContext = contexts[name] as unknown as PublicReadContext;
        if ((await attempt(() => entry.invoke(wrongContext))).ok) {
          violations.push(`${name} was accepted by a cached read`);
        }
      }
      break;
    }
  }
  return violations;
}

/** Registers the conformance tests for a registry against the functions actually exported. */
export function defineAuthzSuite(
  title: string,
  registry: AuthzRegistry,
  exported: readonly string[],
): void {
  describe(title, () => {
    it("registers every exported function, and nothing else", () => {
      expect(registryGaps(exported, registry)).toEqual({
        unregistered: [],
        stale: [],
      });
    });

    for (const [key, entry] of Object.entries(registry)) {
      it(`${key} conforms as ${entry.kind}`, async () => {
        expect(await authzViolations(entry)).toEqual([]);
      });
    }
  });
}
