import { authedRoute, uuidParam } from "../../../../../../server/http/authed";
import { noContent } from "../../../../../../server/http/handler";
import * as relationWrites from "../../../../../../server/services/relation-writes";

// docs/API.md §8.3 — adds the startup to a batch.

export const POST = authedRoute(
  { access: "editor", body: "json" },
  async ({ ctx, params, body }) => {
    await relationWrites.addBatch(
      ctx,
      uuidParam(params, "slug"),
      body as never,
    );
    return noContent();
  },
);
