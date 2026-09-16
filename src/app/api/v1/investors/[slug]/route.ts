import { PUBLIC_READ } from "../../../../../server/auth/context";
import { getInvestorPage } from "../../../../../server/cache/investors";
import { adminReadRoutes } from "../../../../../server/http/admin-read-routes";
import { byOrigin } from "../../../../../server/http/authed";
import { investorRoutes } from "../../../../../server/http/entity-routes";
import {
  API_V1,
  fromLookup,
  publicRead,
} from "../../../../../server/http/handler";
import { noQuery } from "../../../../../server/validation/queries";

// docs/API.md §6.5 by slug on the public origin; §8.1 by id on the admin origin.

const investorPage = publicRead(noQuery, async ({ params }) =>
  fromLookup(
    await getInvestorPage(PUBLIC_READ, params.slug ?? ""),
    (slug) => `${API_V1}/investors/${slug}`,
  ),
);

export const GET = byOrigin({
  admin: adminReadRoutes.investor.record,
  public: investorPage,
});

export const PATCH = investorRoutes.update;
export const DELETE = investorRoutes.remove;
