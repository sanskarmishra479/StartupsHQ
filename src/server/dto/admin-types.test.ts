import { describe, expectTypeOf, it } from "vitest";
import type * as Client from "../../types/admin";
import type * as Panel from "../services/admin-panel";
import type * as Reads from "../services/admin-reads";
import type * as Import from "../services/import";
import type * as Media from "../services/media";
import type * as Prefill from "../services/prefill";
import type * as Privacy from "../services/privacy";
import type * as Users from "../services/users";

// The admin panel's client-safe copies in src/types/admin.ts must match what the services return.
// Checked by `pnpm typecheck`; the test body does nothing at run time.

describe("src/types/admin.ts", () => {
  it("matches the admin services exactly", () => {
    expectTypeOf<Client.AdminEntity>().toEqualTypeOf<Reads.AdminEntity>();
    expectTypeOf<Client.AdminListItem>().toEqualTypeOf<Reads.AdminListItem>();
    expectTypeOf<Client.AdminRecord>().toEqualTypeOf<Reads.AdminRecord>();
    expectTypeOf<Client.Lookups>().toEqualTypeOf<Panel.Lookups>();
    expectTypeOf<Client.MediaItem>().toEqualTypeOf<Panel.MediaItem>();
    expectTypeOf<Client.CategoryCopy>().toEqualTypeOf<Panel.CategoryCopy>();
    expectTypeOf<Client.UploadedAsset>().toEqualTypeOf<Media.UploadedAsset>();
    expectTypeOf<Client.PrefillDraft>().toEqualTypeOf<Prefill.PrefillDraft>();
    expectTypeOf<Client.DryRunResult>().toEqualTypeOf<Import.DryRunResult>();
    expectTypeOf<Client.CommitResult>().toEqualTypeOf<Import.CommitResult>();
    expectTypeOf<Client.AdminUser>().toEqualTypeOf<Users.AdminUser>();
    expectTypeOf<Client.PrivacyRequest>().toEqualTypeOf<Privacy.PrivacyRequest>();
  });
});
