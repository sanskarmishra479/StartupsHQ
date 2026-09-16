import { authedRoute, uuidParam } from "../../../../../server/http/authed";
import { resource } from "../../../../../server/http/handler";
import * as users from "../../../../../server/services/users";

// docs/API.md §8.8 — changes a role, which signs that user out everywhere (SEC-04).

export const PATCH = authedRoute(
  { access: "admin", body: "json" },
  async ({ ctx, params, body }) =>
    resource(
      await users.changeRole(ctx, uuidParam(params, "id"), body as never),
    ),
);
