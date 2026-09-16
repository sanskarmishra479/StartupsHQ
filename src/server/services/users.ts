import "server-only";

import { randomBytes } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { getAuth } from "../auth/better-auth";
import type { ReadContext, Role } from "../auth/context";
import { type AdminContext, assertAdmin } from "../auth/guards";
import { createCredentialUser } from "../auth/users";
import { writeAudit } from "../db/audit";
import { getDb, type Transaction } from "../db/client";
import { runMutation } from "../db/mutation";
import { sessions, twoFactors, users } from "../db/schema";
import { sendEmail } from "../lib/email";
import {
  ConflictError,
  NotFoundError,
  UnprocessableError,
} from "../lib/errors";
import { adminOrigin } from "../lib/origin";
import { isUuid, parseInput } from "../validation/shared";
import {
  type ChangeRoleInput,
  changeRoleSchema,
  type InviteUserInput,
  inviteUserSchema,
} from "../validation/users";

// Staff accounts (docs/API.md §8.8, FR-208). Every account here belongs to an editor or an admin
// an existing admin invited; the directory has no public accounts and sign-up is closed.
//
// - An invite creates the account with an unusable random password and sends the standard
//   password-reset link, worded as an invite. The invitee sets a password and must then enrol
//   TOTP before anything they do counts (FR-201).
// - A role change, a two-factor reset and a deactivation each revoke that user's sessions, which
//   is the rotation on privilege change SEC-04 requires.
// - An admin can neither demote nor deactivate themselves, so the admins cannot all disappear.

export type AdminUser = Readonly<{
  id: string;
  email: string;
  name: string;
  role: Role;
  twoFactorEnabled: boolean;
  deactivatedAt: string | null;
  createdAt: string;
}>;

const columns = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  twoFactorEnabled: users.twoFactorEnabled,
  deactivatedAt: users.deactivatedAt,
  createdAt: users.createdAt,
};

type UserRow = Readonly<{
  id: string;
  email: string;
  name: string;
  role: Role;
  twoFactorEnabled: boolean;
  deactivatedAt: Date | null;
  createdAt: Date;
}>;

const toAdminUser = (row: UserRow): AdminUser => ({
  id: row.id,
  email: row.email,
  name: row.name,
  role: row.role,
  twoFactorEnabled: row.twoFactorEnabled,
  deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

async function lockUser(tx: Transaction, id: string): Promise<UserRow> {
  if (!isUuid(id)) throw new NotFoundError();
  const [row] = await tx
    .select(columns)
    .from(users)
    .where(eq(users.id, id))
    .for("update");
  if (!row) throw new NotFoundError();
  return row;
}

/** Better Auth mints the token and the sendResetPassword callback words it as an invite. */
async function sendInvite(email: string): Promise<void> {
  await getAuth().api.requestPasswordReset({
    body: {
      email,
      redirectTo: `${adminOrigin()}/admin/reset-password?invite=1`,
    },
  });
}

export async function listUsers(ctx: ReadContext): Promise<AdminUser[]> {
  assertAdmin(ctx);
  const rows = await getDb()
    .select(columns)
    .from(users)
    .orderBy(asc(users.email));
  return rows.map(toAdminUser);
}

export async function inviteUser(
  ctx: ReadContext,
  input: InviteUserInput,
): Promise<AdminUser> {
  assertAdmin(ctx);
  const { email, role, name } = parseInput(inviteUserSchema, input);
  const address = email.trim().toLowerCase();
  const db = getDb();

  const [existing] = await db
    .select(columns)
    .from(users)
    .where(eq(users.email, address));
  if (existing) {
    // Someone who never enrolled has no usable account yet, so re-send their link instead.
    if (existing.twoFactorEnabled || existing.deactivatedAt !== null) {
      throw new ConflictError("A user with that email already exists.");
    }
    await sendInvite(address);
    return toAdminUser(existing);
  }

  const { id } = await createCredentialUser({
    email: address,
    name: name ?? address.split("@")[0] ?? address,
    // Never disclosed and never used: the invitee sets their own through the link.
    password: randomBytes(32).toString("base64url"),
    role,
  });

  try {
    await sendInvite(address);
  } catch (error) {
    // Nothing is audited yet, so the half-made account can still be removed.
    await db.delete(users).where(eq(users.id, id));
    throw error;
  }

  return runMutation(async (tx) => {
    const row = await lockUser(tx, id);
    await writeAudit(tx, ctx, {
      entityType: "user",
      entityId: id,
      action: "invite",
      // The address is personal data: recorded by name only (DM-12).
      diff: { role: { from: null, to: role }, email: { changed: true } },
    });
    return toAdminUser(row);
  });
}

export async function changeRole(
  ctx: ReadContext,
  id: string,
  input: ChangeRoleInput,
): Promise<AdminUser> {
  assertAdmin(ctx);
  const actor: AdminContext = ctx;
  const { role } = parseInput(changeRoleSchema, input);

  return runMutation(async (tx) => {
    const current = await lockUser(tx, id);
    if (current.role === role) return toAdminUser(current);
    if (current.id === actor.actor.id) {
      throw new UnprocessableError("You can't change your own role.");
    }

    const [updated] = await tx
      .update(users)
      .set({ role })
      .where(eq(users.id, id))
      .returning(columns);
    if (!updated) throw new NotFoundError();
    // Rotation on privilege change (SEC-04): they sign in again, with the new role.
    await tx.delete(sessions).where(eq(sessions.userId, id));
    await writeAudit(tx, ctx, {
      entityType: "user",
      entityId: id,
      action: "role_change",
      diff: { role: { from: current.role, to: role } },
    });
    return toAdminUser(updated);
  });
}

export async function resetTwoFactor(
  ctx: ReadContext,
  id: string,
): Promise<AdminUser> {
  assertAdmin(ctx);
  const result = await runMutation(async (tx) => {
    const current = await lockUser(tx, id);
    const [updated] = await tx
      .update(users)
      .set({ twoFactorEnabled: false })
      .where(eq(users.id, id))
      .returning(columns);
    if (!updated) throw new NotFoundError();
    await tx.delete(twoFactors).where(eq(twoFactors.userId, id));
    await tx.delete(sessions).where(eq(sessions.userId, id));
    await writeAudit(tx, ctx, {
      entityType: "user",
      entityId: id,
      action: "reset_two_factor",
    });
    return { user: toAdminUser(updated), email: current.email };
  });

  try {
    await sendEmail({
      to: result.email,
      subject: "Your startupsHQ two-factor authentication was reset",
      text: "An administrator reset the two-factor authentication on your startupsHQ account.\n\nYou have been signed out everywhere. The next time you sign in you will set up an authenticator app again.\n\nIf you were not expecting this, contact an administrator immediately.",
    });
  } catch (error) {
    // The reset has already happened; a delivery failure must not suggest otherwise.
    console.error("[users] the two-factor reset notice was not sent", error);
  }
  return result.user;
}

export async function deactivate(
  ctx: ReadContext,
  id: string,
): Promise<AdminUser> {
  assertAdmin(ctx);
  const actor: AdminContext = ctx;

  return runMutation(async (tx) => {
    const current = await lockUser(tx, id);
    if (current.id === actor.actor.id) {
      throw new UnprocessableError("You can't deactivate your own account.");
    }
    if (current.deactivatedAt !== null) return toAdminUser(current);

    const [updated] = await tx
      .update(users)
      .set({ deactivatedAt: new Date() })
      .where(eq(users.id, id))
      .returning(columns);
    if (!updated) throw new NotFoundError();
    await tx.delete(sessions).where(eq(sessions.userId, id));
    await writeAudit(tx, ctx, {
      entityType: "user",
      entityId: id,
      action: "deactivate",
    });
    return toAdminUser(updated);
  });
}

/** Deactivation is reversible; the account keeps its role and enrolled second factor. */
export async function reactivate(
  ctx: ReadContext,
  id: string,
): Promise<AdminUser> {
  assertAdmin(ctx);

  return runMutation(async (tx) => {
    const current = await lockUser(tx, id);
    if (current.deactivatedAt === null) return toAdminUser(current);

    const [updated] = await tx
      .update(users)
      .set({ deactivatedAt: null })
      .where(eq(users.id, id))
      .returning(columns);
    if (!updated) throw new NotFoundError();
    await writeAudit(tx, ctx, {
      entityType: "user",
      entityId: id,
      action: "reactivate",
    });
    return toAdminUser(updated);
  });
}
