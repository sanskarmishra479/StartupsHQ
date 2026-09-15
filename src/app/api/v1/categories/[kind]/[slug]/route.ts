import { PUBLIC_READ } from "../../../../../../server/auth/context";
import { getCategoryPage } from "../../../../../../server/cache/categories";
import {
  orNotFound,
  publicRead,
  resource,
} from "../../../../../../server/http/handler";
import { noQuery } from "../../../../../../server/validation/queries";

// docs/API.md §6.10. Later company pages are `GET /startups` with the matching facet.

export const GET = publicRead(noQuery, async ({ params }) =>
  resource(
    orNotFound(
      await getCategoryPage(PUBLIC_READ, params.kind ?? "", params.slug ?? ""),
    ),
  ),
);
