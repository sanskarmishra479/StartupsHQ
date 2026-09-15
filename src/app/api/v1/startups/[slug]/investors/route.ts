import { authedRoute, uuidParam } from "../../../../../../server/http/authed";
import { created } from "../../../../../../server/http/handler";
import * as relationWrites from "../../../../../../server/services/relation-writes";

// docs/API.md §8.3 — links a backer, optionally to one of this startup's rounds.

export const POST = authedRoute(
  { access: "editor", body: "json" },
  async ({ ctx, params, body }) =>
    created(
      await relationWrites.addInvestor(
        ctx,
        uuidParam(params, "slug"),
        body as never,
      ),
    ),
);
