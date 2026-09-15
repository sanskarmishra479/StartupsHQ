import "server-only";

import { getDb } from "../db/client";
import { users } from "../db/schema";
import { contexts } from "./authz";

/**
 * Users matching the harness's editor and admin contexts, so audit rows can reference a real
 * actor. The seed never touches auth tables, so this is idempotent across test files.
 */
export async function ensureTestUsers(): Promise<void> {
  await getDb()
    .insert(users)
    .values([
      {
        id: contexts.editor.actor.id,
        name: "Test Editor",
        email: "editor@example.com",
        role: "editor",
        twoFactorEnabled: true,
      },
      {
        id: contexts.admin.actor.id,
        name: "Test Admin",
        email: "admin@example.com",
        role: "admin",
        twoFactorEnabled: true,
      },
    ])
    .onConflictDoNothing();
}
