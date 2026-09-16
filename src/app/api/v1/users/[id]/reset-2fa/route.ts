import { authedRoute, uuidParam } from "../../../../../../server/http/authed";
import { resource } from "../../../../../../server/http/handler";
import * as users from "../../../../../../server/services/users";

// docs/API.md §8.8 — forces re-enrolment and revokes sessions.

export const POST = authedRoute({ access: "admin" }, async ({ ctx, params }) =>
  resource(await users.resetTwoFactor(ctx, uuidParam(params, "id"))),
);
