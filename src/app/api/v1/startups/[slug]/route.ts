import { PUBLIC_READ } from "../../../../../server/auth/context";
import { getStartupPage } from "../../../../../server/cache/startups";
import { adminReadRoutes } from "../../../../../server/http/admin-read-routes";
import { byOrigin } from "../../../../../server/http/authed";
import { startupRoutes } from "../../../../../server/http/entity-routes";
import {
  API_V1,
  fromLookup,
  publicRead,
} from "../../../../../server/http/handler";
import { noQuery } from "../../../../../server/validation/queries";

// docs/API.md §6.2 by slug on the public origin; §8.1 by id on the admin origin.

const startupPage = publicRead(noQuery, async ({ params }) =>
  fromLookup(
    await getStartupPage(PUBLIC_READ, params.slug ?? ""),
    (slug) => `${API_V1}/startups/${slug}`,
  ),
);

export const GET = byOrigin({
  admin: adminReadRoutes.startup.record,
  public: startupPage,
});

export const PATCH = startupRoutes.update;
export const DELETE = startupRoutes.remove;
