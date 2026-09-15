import { PUBLIC_READ } from "../../../../../server/auth/context";
import { getBatchPage } from "../../../../../server/cache/batches";
import { batchRoutes } from "../../../../../server/http/entity-routes";
import {
  API_V1,
  fromLookup,
  publicRead,
} from "../../../../../server/http/handler";
import { noQuery } from "../../../../../server/validation/queries";

// docs/API.md §6.8. Later cohort pages are `GET /startups?batch={slug}`.

export const GET = publicRead(noQuery, async ({ params }) =>
  fromLookup(
    await getBatchPage(PUBLIC_READ, params.slug ?? ""),
    (slug) => `${API_V1}/batches/${slug}`,
  ),
);

// docs/API.md §8.1 — by id.

export const PATCH = batchRoutes.update;
export const DELETE = batchRoutes.remove;
