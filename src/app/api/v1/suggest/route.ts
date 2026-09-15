import { publicRead, resource } from "../../../../server/http/handler";
import * as search from "../../../../server/services/search";
import { suggestQuery } from "../../../../server/validation/queries";

// docs/API.md §6.12. Not cached per query (ADR-013).

export const GET = publicRead(suggestQuery, async ({ ctx, query }) =>
  resource(await search.suggest(ctx, query.q)),
);
