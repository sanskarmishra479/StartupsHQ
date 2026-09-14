import { join } from "node:path";
import {
  type AuthzRegistry,
  collectExportedFunctions,
  defineAuthzSuite,
} from "../testing/authz";

// The authz conformance suite (docs/TEST_PLAN.md §7, SEC-03, NFR-10).
//
// Every exported function in src/server/services and src/server/cache must be registered here
// with its kind; an unregistered or stale entry fails the build. Services arrive in Phase 4.

const REGISTRY: AuthzRegistry = {};

const serverDir = join(import.meta.dirname, "..");

const exported = [
  ...(await collectExportedFunctions(join(serverDir, "services"))).map(
    (key) => `services/${key}`,
  ),
  ...(await collectExportedFunctions(join(serverDir, "cache"))).map(
    (key) => `cache/${key}`,
  ),
];

defineAuthzSuite(
  "authz conformance: services and cached reads",
  REGISTRY,
  exported,
);
