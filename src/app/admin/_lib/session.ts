import "server-only";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { AuthedContext } from "@/server/auth/context";
import {
  getSessionStatus,
  type SessionStatus,
  type SessionUser,
} from "@/server/auth/session";

// The admin pages' session checks. Pages never decide access alone: every read they make goes
// through a service that asserts the actor again, and every write through the API (SEC-03.5).

export const readSession = async (): Promise<SessionStatus> =>
  getSessionStatus(await headers());

export type PanelSession = Readonly<{
  ctx: AuthedContext;
  user: SessionUser;
  isAdmin: boolean;
}>;

/** An editor or admin who has completed two-factor, or a redirect to where they must go next. */
export async function requirePanel(): Promise<PanelSession> {
  const status = await readSession();
  if (status.kind === "anonymous") redirect("/admin/login");
  if (status.kind === "enrollment-required") redirect("/admin/enroll");
  return {
    ctx: status.ctx,
    user: status.user,
    isAdmin: status.ctx.actor.role === "admin",
  };
}

/** Admin-only pages look absent to editors, as the API's 403 would be of no use to them. */
export async function requireAdminPanel(): Promise<PanelSession> {
  const session = await requirePanel();
  if (!session.isAdmin) notFound();
  return session;
}
