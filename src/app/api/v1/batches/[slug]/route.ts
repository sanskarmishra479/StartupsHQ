import { PUBLIC_READ } from "../../../../../server/auth/context";
import { getBatchPage } from "../../../../../server/cache/batches";
import { adminReadRoutes } from "../../../../../server/http/admin-read-routes";
import { byOrigin } from "../../../../../server/http/authed";
import { batchRoutes } from "../../../../../server/http/entity-routes";
import {
  API_V1,
  fromLookup,
  publicRead,
} from "../../../../../server/http/handler";
import { noQuery } from "../../../../../server/validation/queries";

// docs/API.md §6.8 by slug on the public origin; §8.1 by id on the admin origin.
// Later cohort pages are `GET /startups?batch={slug}`.

const batchPage = publicRead(noQuery, async ({ params }) =>
  fromLookup(
    await getBatchPage(PUBLIC_READ, params.slug ?? ""),
    (slug) => `${API_V1}/batches/${slug}`,
  ),
);

export const GET = byOrigin({
  admin: adminReadRoutes.batch.record,
  public: batchPage,
});

export const PATCH = batchRoutes.update;
export const DELETE = batchRoutes.remove;
