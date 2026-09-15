import { body, publicRead } from "../../../../server/http/handler";
import * as search from "../../../../server/services/search";
import { searchQuery } from "../../../../server/validation/queries";

// docs/API.md §6.11. Not cached per query (ADR-013).

export const GET = publicRead(searchQuery, async ({ ctx, query }) =>
  body(await search.search(ctx, query)),
);
