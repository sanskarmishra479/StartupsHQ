import {
  authedRoute,
  uuidParam,
} from "../../../../../../../server/http/authed";
import { noContent } from "../../../../../../../server/http/handler";
import * as relationWrites from "../../../../../../../server/services/relation-writes";

// docs/API.md §8.3 — removes one investor link.

export const DELETE = authedRoute(
  { access: "editor" },
  async ({ ctx, params }) => {
    await relationWrites.removeInvestor(
      ctx,
      uuidParam(params, "slug"),
      uuidParam(params, "linkId"),
    );
    return noContent();
  },
);
