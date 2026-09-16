import { authedRoute } from "../../../../server/http/authed";
import { resource } from "../../../../server/http/handler";
import * as users from "../../../../server/services/users";

// docs/API.md §8.8 (FR-208) — staff accounts, admin only.

export const GET = authedRoute({ access: "admin" }, async ({ ctx }) =>
  resource(await users.listUsers(ctx)),
);
