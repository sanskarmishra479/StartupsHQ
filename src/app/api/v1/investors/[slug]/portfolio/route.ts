import { collection, publicRead } from "../../../../../../server/http/handler";
import * as investors from "../../../../../../server/services/investors";
import { portfolioQuery } from "../../../../../../server/validation/queries";

// docs/API.md §6.6

export const GET = publicRead(portfolioQuery, async ({ ctx, params, query }) =>
  collection(await investors.getPortfolio(ctx, params.slug ?? "", query)),
);
