import { parseArgs } from "node:util";
import { loadEnvConfig } from "@next/env";
import { createCredentialUser } from "../src/server/auth/users";
import { closeDb } from "../src/server/db/client";

// Creates the first admin (FR-201, FR-208).
//
//   read -rs SEED_ADMIN_PASSWORD && export SEED_ADMIN_PASSWORD
//   pnpm seed:admin --email you@example.com --name "Your Name"
//
// The password is read only from SEED_ADMIN_PASSWORD, never from a command-line argument, which
// would land in shell history and process listings. The new admin must enrol two-factor at first
// sign-in before they can change anything.

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const { values } = parseArgs({
    options: { email: { type: "string" }, name: { type: "string" } },
  });
  if (!values.email || !values.name) {
    throw new Error(
      'Usage: pnpm seed:admin --email you@example.com --name "Your Name"',
    );
  }
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password) {
    throw new Error(
      "Set SEED_ADMIN_PASSWORD first: read -rs SEED_ADMIN_PASSWORD && export SEED_ADMIN_PASSWORD",
    );
  }

  try {
    const { id } = await createCredentialUser({
      email: values.email,
      name: values.name,
      password,
      role: "admin",
    });
    console.log(
      `Created admin ${id}. Two-factor enrolment is required at first sign-in.`,
    );
  } finally {
    await closeDb();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
