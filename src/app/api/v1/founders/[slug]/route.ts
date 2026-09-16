import { PUBLIC_READ } from "../../../../../server/auth/context";
import { getFounderPage } from "../../../../../server/cache/founders";
import { adminReadRoutes } from "../../../../../server/http/admin-read-routes";
import { byOrigin } from "../../../../../server/http/authed";
import { founderRoutes } from "../../../../../server/http/entity-routes";
import {
  API_V1,
  fromLookup,
  publicRead,
} from "../../../../../server/http/handler";
import { noQuery } from "../../../../../server/validation/queries";

// docs/API.md §6.4 by slug on the public origin; §8.1 by id on the admin origin.

const founderPage = publicRead(noQuery, async ({ params }) =>
  fromLookup(
    await getFounderPage(PUBLIC_READ, params.slug ?? ""),
    (slug) => `${API_V1}/founders/${slug}`,
  ),
);

export const GET = byOrigin({
  admin: adminReadRoutes.founder.record,
  public: founderPage,
});

export const PATCH = founderRoutes.update;
export const DELETE = founderRoutes.remove;
