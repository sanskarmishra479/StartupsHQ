import { authedRoute, uuidParam } from "../../../../../../server/http/authed";
import { resource } from "../../../../../../server/http/handler";
import * as users from "../../../../../../server/services/users";

// docs/API.md §8.8 — switches the account off and revokes its sessions.

export const POST = authedRoute({ access: "admin" }, async ({ ctx, params }) =>
  resource(await users.deactivate(ctx, uuidParam(params, "id"))),
);
