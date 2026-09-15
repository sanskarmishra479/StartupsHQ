import { authedRoute, uuidParam } from "../../../../../../server/http/authed";
import { resource } from "../../../../../../server/http/handler";
import * as privacy from "../../../../../../server/services/privacy";

// docs/API.md §8.9 — resolves a privacy request, admin only.

export const PATCH = authedRoute(
  { access: "admin", body: "json" },
  async ({ ctx, params, body }) =>
    resource(
      await privacy.resolveRequest(ctx, uuidParam(params, "id"), body as never),
    ),
);
