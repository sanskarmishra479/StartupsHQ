import { collection, publicRead } from "../../../../../../server/http/handler";
import * as investors from "../../../../../../server/services/investors";
import { pageQuery } from "../../../../../../server/validation/queries";

// docs/API.md §6.7

export const GET = publicRead(pageQuery, async ({ ctx, params, query }) =>
  collection(await investors.getRoundsLed(ctx, params.slug ?? "", query)),
);
