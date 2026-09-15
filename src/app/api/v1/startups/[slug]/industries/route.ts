import { authedRoute, uuidParam } from "../../../../../../server/http/authed";
import { noContent } from "../../../../../../server/http/handler";
import * as relationWrites from "../../../../../../server/services/relation-writes";

// docs/API.md §8.3 — replaces the startup's industries; more than one primary is a 422.

export const PUT = authedRoute(
  { access: "editor", body: "json" },
  async ({ ctx, params, body }) => {
    await relationWrites.setIndustries(
      ctx,
      uuidParam(params, "slug"),
      body as never,
    );
    return noContent();
  },
);
