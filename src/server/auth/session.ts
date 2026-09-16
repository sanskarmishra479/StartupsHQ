import "server-only";

import { UnauthorizedError } from "../lib/errors";
import { clientIp } from "../lib/ip";
import { getAuth } from "./better-auth";
import {
  type AuthedContext,
  authedContext,
  type PublicContext,
  publicContext,
} from "./context";
import { type AdminContext, assertAdmin } from "./guards";

// From a request's session cookie to a RequestContext (SEC-03.4, FR-201). Fail closed: anything
// that cannot prove an editor or admin who has enrolled two-factor is a public context.

type Env = Readonly<Record<string, string | undefined>>;

export type SessionStatus =
  | Readonly<{ kind: "anonymous"; ctx: PublicContext }>
  /** Signed in with a password, but has not enrolled TOTP yet: may only enrol. */
  | Readonly<{
      kind: "enrollment-required";
      ctx: PublicContext;
      userId: string;
    }>
  | Readonly<{ kind: "authed"; ctx: AuthedContext }>;

export async function getSessionStatus(
  headers: Headers,
  env: Env = process.env,
): Promise<SessionStatus> {
  const ip = clientIp(headers, env);
  const anonymous = { kind: "anonymous", ctx: publicContext(ip) } as const;

  let session: Awaited<
    ReturnType<ReturnType<typeof getAuth>["api"]["getSession"]>
  >;
  try {
    session = await getAuth().api.getSession({ headers });
  } catch {
    // An unverifiable session is no session.
    return anonymous;
  }
  if (!session) return anonymous;

  const { id, role, twoFactorEnabled, deactivatedAt } = session.user as {
    id: string;
    role?: unknown;
    twoFactorEnabled?: unknown;
    deactivatedAt?: unknown;
  };
  // Deactivated accounts keep no access even if a session row somehow survived (FR-208).
  if (deactivatedAt) return anonymous;
  if (role !== "admin" && role !== "editor") return anonymous;
  if (twoFactorEnabled !== true) {
    return { kind: "enrollment-required", ctx: publicContext(ip), userId: id };
  }
  return { kind: "authed", ctx: authedContext({ id, role }, ip) };
}

export async function getSessionContext(
  headers: Headers,
  env: Env = process.env,
): Promise<PublicContext | AuthedContext> {
  return (await getSessionStatus(headers, env)).ctx;
}

/** Layer 2 of 3 (SEC-03.5): a route handler's first line for any write. */
export async function requireEditor(
  headers: Headers,
  env: Env = process.env,
): Promise<AuthedContext> {
  const status = await getSessionStatus(headers, env);
  if (status.kind !== "authed") throw new UnauthorizedError();
  return status.ctx;
}

export async function requireAdmin(
  headers: Headers,
  env: Env = process.env,
): Promise<AdminContext> {
  const ctx = await requireEditor(headers, env);
  assertAdmin(ctx);
  return ctx;
}
