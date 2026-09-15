import "server-only";

import { getAuth, PASSWORD_MIN_LENGTH } from "./better-auth";
import type { Role } from "./context";

// Creating a user with an email and password (scripts/seed-admin.ts; FR-208 invites build on it).
// Better Auth hashes the password. Two-factor is not enrolled here: the first sign-in must enrol
// it before the user can change anything (FR-201).

export type NewCredentialUser = Readonly<{
  email: string;
  name: string;
  password: string;
  role: Role;
}>;

export async function createCredentialUser(
  input: NewCredentialUser,
): Promise<{ id: string }> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("That is not an email address.");
  }
  if (input.password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(
      `The password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    );
  }

  const ctx = await getAuth().$context;
  if (await ctx.internalAdapter.findUserByEmail(email)) {
    throw new Error("A user with that email already exists.");
  }
  const user = await ctx.internalAdapter.createUser(
    {
      email,
      name: input.name.trim(),
      emailVerified: true,
      role: input.role,
      twoFactorEnabled: false,
    },
    // Created by an admin or the seed script, never by self sign-up (which is closed).
    { method: "admin" },
  );
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: await ctx.password.hash(input.password),
  });
  return { id: user.id };
}
