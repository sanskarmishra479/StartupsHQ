import { PUBLIC_READ } from "../../../../../server/auth/context";
import { getInvestorPage } from "../../../../../server/cache/investors";
import { investorRoutes } from "../../../../../server/http/entity-routes";
import {
  API_V1,
  fromLookup,
  publicRead,
} from "../../../../../server/http/handler";
import { noQuery } from "../../../../../server/validation/queries";

// docs/API.md §6.5

export const GET = publicRead(noQuery, async ({ params }) =>
  fromLookup(
    await getInvestorPage(PUBLIC_READ, params.slug ?? ""),
    (slug) => `${API_V1}/investors/${slug}`,
  ),
);

// docs/API.md §8.1 — by id.

export const PATCH = investorRoutes.update;
export const DELETE = investorRoutes.remove;
