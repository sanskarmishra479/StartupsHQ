import { authedRoute, uuidParam } from "../../../../../../server/http/authed";
import { resource } from "../../../../../../server/http/handler";
import * as privacy from "../../../../../../server/services/privacy";

// docs/API.md §8.9 — irreversible founder erasure (FR-410), admin only, with typed confirmation.

export const POST = authedRoute(
  { access: "admin", body: "json" },
  async ({ ctx, params, body }) =>
    resource(
      await privacy.eraseFounder(ctx, uuidParam(params, "slug"), body as never),
    ),
);
