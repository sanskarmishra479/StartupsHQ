import { PUBLIC_READ } from "../../../../../../server/auth/context";
import { getCategoryPage } from "../../../../../../server/cache/categories";
import { authedRoute } from "../../../../../../server/http/authed";
import {
  noContent,
  orNotFound,
  publicRead,
  resource,
} from "../../../../../../server/http/handler";
import * as categoryWrites from "../../../../../../server/services/category-writes";
import { noQuery } from "../../../../../../server/validation/queries";

// docs/API.md §6.10. Later company pages are `GET /startups` with the matching facet.

export const GET = publicRead(noQuery, async ({ params }) =>
  resource(
    orNotFound(
      await getCategoryPage(PUBLIC_READ, params.kind ?? "", params.slug ?? ""),
    ),
  ),
);

// docs/API.md §8.4 — copy for an existing facet value only; anything else is a 404.

export const PATCH = authedRoute(
  { access: "editor", body: "json" },
  async ({ ctx, params, body }) => {
    await categoryWrites.updateCopy(
      ctx,
      params.kind ?? "",
      params.slug ?? "",
      body as never,
    );
    return noContent();
  },
);
