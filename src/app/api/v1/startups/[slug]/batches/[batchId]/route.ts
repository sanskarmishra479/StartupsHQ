import {
  authedRoute,
  uuidParam,
} from "../../../../../../../server/http/authed";
import { noContent } from "../../../../../../../server/http/handler";
import * as relationWrites from "../../../../../../../server/services/relation-writes";

// docs/API.md §8.3 — removes the startup from a batch.

export const DELETE = authedRoute(
  { access: "editor" },
  async ({ ctx, params }) => {
    await relationWrites.removeBatch(
      ctx,
      uuidParam(params, "slug"),
      uuidParam(params, "batchId"),
    );
    return noContent();
  },
);
