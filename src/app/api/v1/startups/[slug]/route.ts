import { PUBLIC_READ } from "../../../../../server/auth/context";
import { getStartupPage } from "../../../../../server/cache/startups";
import { startupRoutes } from "../../../../../server/http/entity-routes";
import {
  API_V1,
  fromLookup,
  publicRead,
} from "../../../../../server/http/handler";
import { noQuery } from "../../../../../server/validation/queries";

// docs/API.md §6.2

export const GET = publicRead(noQuery, async ({ params }) =>
  fromLookup(
    await getStartupPage(PUBLIC_READ, params.slug ?? ""),
    (slug) => `${API_V1}/startups/${slug}`,
  ),
);

// docs/API.md §8.1 — by id.

export const PATCH = startupRoutes.update;
export const DELETE = startupRoutes.remove;
