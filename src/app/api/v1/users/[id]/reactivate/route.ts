import { authedRoute, uuidParam } from "../../../../../../server/http/authed";
import { resource } from "../../../../../../server/http/handler";
import * as users from "../../../../../../server/services/users";

// docs/API.md §8.8 — undoes a deactivation; the account keeps its role and second factor.

export const POST = authedRoute({ access: "admin" }, async ({ ctx, params }) =>
  resource(await users.reactivate(ctx, uuidParam(params, "id"))),
);
